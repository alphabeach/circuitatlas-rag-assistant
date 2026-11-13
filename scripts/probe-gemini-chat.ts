/**
 * Tests Gemini chat models for streaming support and answer quality.
 *
 * Usage: npx tsx scripts/probe-gemini-chat.ts [model]
 */

import { readFileSync } from "node:fs";

const raw = readFileSync(".env.local", "utf8");
const KEY = raw.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim() ?? "";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const SYSTEM = `You are CircuitAtlas, an assistant for laboratory technicians.
Answer ONLY from the CONTEXT. Cite every claim with the source id in square brackets, e.g. [S1].
If the context does not contain the answer, reply exactly: INSUFFICIENT_CONTEXT: <reason>`;

async function testChat(model: string): Promise<{
  ok: boolean;
  output?: string;
  error?: string;
  frames?: number;
}> {
  try {
    const response = await fetch(
      `${BASE}/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "CONTEXT:\n[S1] (source: SOP-1142 / 3. Procedure)\n3.1 Pellet the cells at 300 x g for 5 minutes at 4 C.\n[S2] (source: SOP-1142 / 4. SAFETY REQUIREMENTS)\nWear nitrile gloves, a lab coat, and eye protection at all times.\n\n---\n\nQUESTION: What centrifugation speed and duration should I use, and what PPE do I need?\n\nAnswer using only the CONTEXT above, citing sources as [S1], [S2], etc.",
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 1024 },
        }),
      },
    );

    if (!response.ok) {
      return { ok: false, error: `${response.status} ${(await response.text()).slice(0, 120)}` };
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

    return { ok: true, output: output.trim(), frames: frames.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    };
  }
}

async function main() {
  const models =
    process.argv[2] !== undefined
      ? [process.argv[2]]
      : [
          "gemini-3.8-flash",
          "gemini-3.7-flash",
          "gemini-3.5-flash",
          "gemini-4-hydrogen",
        ];

  for (const model of models) {
    const result = await testChat(model);

    if (!result.ok) {
      console.log(`  ${model.padEnd(24)} FAILED - ${result.error}`);
      continue;
    }

    const output = result.output ?? "";
    const citesS1 = /\[S1\]/.test(output);
    const citesS2 = /\[S2\]/.test(output);
    const hasSpeed = /300\s*x\s*g/i.test(output);
    const hasDuration = /5\s*min/i.test(output);
    const hasPpe = /glove/i.test(output);

    console.log(`  ${model.padEnd(24)} ${result.frames} frames`);
    console.log(`      cites S1=${citesS1} S2=${citesS2} | speed=${hasSpeed} duration=${hasDuration} ppe=${hasPpe}`);
    console.log(`      "${output.replace(/\s+/g, " ").slice(0, 220)}"`);
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
