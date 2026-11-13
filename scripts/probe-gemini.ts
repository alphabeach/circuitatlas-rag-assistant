/**
 * Smoke test for the Gemini provider.
 *
 * Verifies the API key, the embedding model, the output dimension, and the
 * chat model in one pass.
 *
 * Usage: npx tsx scripts/probe-gemini.ts
 */

import { readFileSync } from "node:fs";

function envValue(name: string): string {
  const raw = readFileSync(".env.local", "utf8");
  const match = raw.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!match) throw new Error(`${name} not found in .env.local`);
  return match[1].trim();
}

const KEY = envValue("GEMINI_API_KEY");
const EMBEDDING_MODEL = envValue("GEMINI_EMBEDDING_MODEL");
const CHAT_MODEL = envValue("GEMINI_CHAT_MODEL");
const DIMENSIONS = Number(envValue("EMBEDDING_DIMENSIONS"));
const BASE = "https://generativelanguage.googleapis.com/v1beta";

async function probeEmbeddings() {
  const response = await fetch(
    `${BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": KEY,
      },
      body: JSON.stringify({
        requests: [
          "Centrifuge at 300 x g for 5 minutes at 4 C.",
          "Wear nitrile gloves and a lab coat.",
        ].map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: DIMENSIONS,
        })),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `${response.status}: ${(await response.text()).slice(0, 400)}`,
    );
  }

  const body = await response.json();
  const vectors = body.embeddings ?? [];

  console.log(
    `  embeddings: ${vectors.length} vector(s), ` +
      `dims=${vectors[0]?.values?.length ?? "?"} ` +
      `(expected ${DIMENSIONS})`,
  );

  if (vectors.length !== 2) {
    throw new Error(`Expected 2 embeddings, got ${vectors.length}`);
  }
  if (vectors[0]?.values?.length !== DIMENSIONS) {
    throw new Error(
      `Dimension mismatch: got ${vectors[0]?.values?.length}, expected ${DIMENSIONS}`,
    );
  }
}

async function probeChat() {
  const response = await fetch(
    `${BASE}/models/${CHAT_MODEL}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": KEY,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "Answer with the exact number only." }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: "What is 17 * 23? Reply with just the number." }],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 256 },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `${response.status}: ${(await response.text()).slice(0, 400)}`,
    );
  }

  const text = await response.text();
  const frames = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  let output = "";
  for (const frame of frames) {
    try {
      const parsed = JSON.parse(frame);
      for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought) continue;
        output += part.text ?? "";
      }
    } catch {
      // ignore non-JSON frames
    }
  }

  console.log(`  chat: ${frames.length} frame(s), output="${output.trim()}"`);
}

async function main() {
  console.log(`\nGemini provider probe`);
  console.log(`  embedding model: ${EMBEDDING_MODEL}`);
  console.log(`  chat model:      ${CHAT_MODEL}\n`);

  try {
    await probeEmbeddings();
    console.log("  embeddings OK");
  } catch (error) {
    console.error(
      `  embeddings FAILED: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  try {
    await probeChat();
    console.log("  chat OK");
  } catch (error) {
    console.error(
      `  chat FAILED: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  console.log("\nAll Gemini probes passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
