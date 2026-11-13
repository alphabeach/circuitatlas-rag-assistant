/**
 * Lists Gemini models available to the configured API key.
 *
 * Usage: npx tsx scripts/list-gemini-models.ts
 */

import { readFileSync } from "node:fs";

const raw = readFileSync(".env.local", "utf8");
const KEY = raw.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim() ?? "";

async function main() {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models",
    { headers: { "x-goog-api-key": KEY } },
  );

  if (!response.ok) {
    console.error(`${response.status}: ${(await response.text()).slice(0, 400)}`);
    process.exit(1);
  }

  const body = await response.json();
  const models: Array<{
    name: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }> = body.models ?? [];

  const chat = models.filter((model) =>
    model.supportedGenerationMethods?.includes("generateContent"),
  );

  console.log(`\n${models.length} models, ${chat.length} support generateContent:\n`);

  for (const model of chat) {
    console.log(
      `  ${model.name.replace("models/", "").padEnd(34)} ` +
        `in=${String(model.inputTokenLimit ?? "?").padStart(7)} ` +
        `out=${String(model.outputTokenLimit ?? "?").padStart(7)}`,
    );
  }

  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
