/**
 * Calibrates the retrieval thresholds against the configured embedding
 * provider.
 *
 * Embeds a set of SOP chunks plus in-domain and out-of-domain queries, then
 * reports the score distribution so ABSOLUTE_FLOOR and RELATIVE_DELTA can
 * be set from measurements rather than guesses.
 *
 * Usage: npx tsx scripts/calibrate-retrieval.ts
 */

import { readFileSync } from "node:fs";

const CHUNKS = [
  {
    id: "lysis",
    text: "3.2 Aspirate the supernatant and resuspend the pellet in 500 uL of ice-cold RIPA buffer containing 1x protease inhibitor.",
  },
  {
    id: "safety",
    text: "SAFETY REQUIREMENTS. Wear nitrile gloves, a lab coat, and eye protection at all times. RIPA buffer contains detergents and is hazardous; handle all waste in the designated chemical waste container.",
  },
  {
    id: "storage",
    text: "Store the purified protein at -80 C in aliquots of 20 uL. Avoid repeated freeze-thaw cycles. Store the buffer at 4 C for no more than one month.",
  },
  {
    id: "qc",
    text: "Acceptance Criteria. Protein concentration must be between 0.5 and 5.0 mg/mL. Samples outside this range must be diluted and re-measured before use.",
  },
  {
    id: "centrifuge",
    text: "3.1 Pellet the cells at 300 x g for 5 minutes at 4 C.",
  },
  {
    id: "incubate",
    text: "3.3 Incubate on ice for 15 minutes, vortexing briefly every 5 minutes.",
  },
];

const IN_DOMAIN = [
  "What temperature do I centrifuge at?",
  "How long should I incubate the lysate on ice?",
  "What PPE is required for this procedure?",
  "How do I store purified protein?",
  "What is the acceptable protein concentration range?",
  "What buffer volume do I resuspend the pellet in?",
];

const OUT_OF_DOMAIN = [
  "How do I calibrate the mass spectrometer?",
  "What is the corporate holiday policy?",
  "How do I sequence the plasmid with Sanger sequencing?",
  "What laptop do you recommend for the lab?",
  "How do I file my expense report?",
];

function envValue(name: string): string {
  const raw = readFileSync(".env.local", "utf8");
  const match = raw.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!match) throw new Error(`${name} not found in .env.local`);
  return match[1].trim();
}

const PROVIDER = envValue("AI_PROVIDER");
const DIMENSIONS = Number(envValue("EMBEDDING_DIMENSIONS"));

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedGemini(
  texts: string[],
  task: "document" | "query",
): Promise<number[][]> {
  const key = envValue("GEMINI_API_KEY");
  const model = envValue("GEMINI_EMBEDDING_MODEL");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType:
            task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: DIMENSIONS,
        })),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = await response.json();
  return (body.embeddings ?? []).map(
    (embedding: { values: number[] }) => embedding.values,
  );
}

async function embedOpenRouter(texts: string[]): Promise<number[][]> {
  const key = envValue("OPENROUTER_API_KEY");
  const model = envValue("OPENROUTER_EMBEDDING_MODEL");

  const vectors: number[][] = [];
  for (const text of texts) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text,
          encoding_format: "float",
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }

    const body = await response.json();
    vectors.push(body.data[0].embedding);
  }
  return vectors;
}

async function main() {
  console.log(`\nCalibrating retrieval thresholds (provider: ${PROVIDER})\n`);

  const chunkVectors =
    PROVIDER === "gemini"
      ? await embedGemini(
          CHUNKS.map((c) => c.text),
          "document",
        )
      : await embedOpenRouter(CHUNKS.map((c) => c.text));

  const queryVectors =
    PROVIDER === "gemini"
      ? await embedGemini(IN_DOMAIN, "query")
      : await embedOpenRouter(IN_DOMAIN);

  const negativeVectors =
    PROVIDER === "gemini"
      ? await embedGemini(OUT_OF_DOMAIN, "query")
      : await embedOpenRouter(OUT_OF_DOMAIN);

  console.log(`  dims: ${chunkVectors[0].length}\n`);

  const inDomainTop: number[] = [];
  const margins: number[] = [];
  let hits = 0;

  IN_DOMAIN.forEach((query, index) => {
    const ranked = CHUNKS.map((chunk, chunkIndex) => ({
      id: chunk.id,
      score: cosine(queryVectors[index], chunkVectors[chunkIndex]),
    })).sort((a, b) => b.score - a.score);

    const correct = ranked[0].id === EXPECTED[index];
    if (correct) hits++;
    inDomainTop.push(ranked[0].score);
    margins.push(ranked[0].score - ranked[1].score);

    console.log(
      `  ${correct ? "PASS" : "FAIL"} "${query}"\n` +
        `       top=${ranked[0].id} ${ranked[0].score.toFixed(3)}  ` +
        `2nd=${ranked[1].id} ${ranked[1].score.toFixed(3)}  ` +
        `margin=${(ranked[0].score - ranked[1].score).toFixed(3)}`,
    );
  });

  const noiseTop = negativeVectors.map((vector) =>
    Math.max(
      ...CHUNKS.map((_, chunkIndex) => cosine(vector, chunkVectors[chunkIndex])),
    ),
  );

  console.log("");
  OUT_OF_DOMAIN.forEach((query, index) => {
    console.log(`  NEG  "${query}" -> ${noiseTop[index].toFixed(3)}`);
  });

  const weakestTrue = Math.min(...inDomainTop);
  const strongestNoise = Math.max(...noiseTop);
  const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;

  console.log(
    `\n  top-1 accuracy      ${(hits / IN_DOMAIN.length) * 100}% (${hits}/${IN_DOMAIN.length})\n` +
      `  weakest TRUE score  ${weakestTrue.toFixed(3)}\n` +
      `  strongest NOISE     ${strongestNoise.toFixed(3)}\n` +
      `  avg margin          ${avgMargin.toFixed(3)}\n` +
      `\n  Recommended ABSOLUTE_FLOOR: ${(strongestNoise + 0.02).toFixed(2)}\n` +
      `  Recommended RELATIVE_DELTA: ${Math.max(0.08, avgMargin).toFixed(2)}\n` +
      `  (floor must be > ${strongestNoise.toFixed(3)} and <= ${weakestTrue.toFixed(3)})\n`,
  );
}

const EXPECTED = ["centrifuge", "incubate", "safety", "storage", "qc", "lysis"];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
