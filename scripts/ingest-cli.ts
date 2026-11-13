/**
 * Bulk ingest CLI.
 *
 * Ingests every .md/.txt file in a directory (recursively) using the same
 * pipeline as the web upload, which keeps the two paths from drifting.
 *
 * Usage:
 *   npm run ingest:cli -- ./sops
 *   npm run ingest:cli -- ./sops --tags safety,qc
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ingestDocument } from "../src/lib/rag/ingest";

const ACCEPTED = new Set([".md", ".markdown", ".txt"]);

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (ACCEPTED.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseArgs(argv: string[]) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const tagsIndex = argv.indexOf("--tags");
  const tags =
    tagsIndex !== -1 && argv[tagsIndex + 1]
      ? argv[tagsIndex + 1]
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

  return { root: positional[0] ?? "./sops", tags };
}

async function main() {
  const { root, tags } = parseArgs(process.argv.slice(2));

  console.log(`Scanning ${root} for Markdown and text files...`);

  let files: string[];
  try {
    files = await collectFiles(root);
  } catch (error) {
    console.error(
      `Could not read ${root}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No .md or .txt files found. Nothing to ingest.");
    return;
  }

  console.log(`Found ${files.length} file(s). Ingesting...\n`);

  let succeeded = 0;
  let failed = 0;
  let totalChunks = 0;

  for (const file of files) {
    try {
      const raw = await readFile(file, "utf8");
      const result = await ingestDocument(raw, path.basename(file), { tags });

      succeeded++;
      totalChunks += result.chunkCount;
      console.log(
        `  ok   ${file} -> ${result.chunkCount} chunks (${result.title})`,
      );
    } catch (error) {
      failed++;
      console.error(
        `  fail ${file}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.log(
    `\nDone. ${succeeded} ingested (${totalChunks} chunks), ${failed} failed.`,
  );

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
