/**
 * Diagnostics for the PDF parser against a real document.
 *
 * Reports chunk counts, size distribution, detected headings, and sample
 * chunks so the heading heuristic can be judged on real PDFs rather than
 * synthetic fixtures.
 *
 * Usage: npx tsx scripts/inspect-pdf.ts <path.pdf>
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { parsePdf } from "../src/lib/parsers/pdf";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/inspect-pdf.ts <path.pdf>");
    process.exit(1);
  }

  const buffer = new Uint8Array(readFileSync(file));
  const chunks = await parsePdf(buffer);

  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`  chunks: ${chunks.length}`);

  const sizes = chunks.map((c) => c.content.length);
  console.log(
    `  size: min=${Math.min(...sizes)} max=${Math.max(...sizes)} ` +
      `avg=${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`,
  );

  const pages = new Set(chunks.map((c) => c.metadata.page));
  console.log(`  pages covered: ${pages.size}`);

  const withHeading = chunks.filter((c) => c.metadata.heading);
  console.log(`  chunks with a detected heading: ${withHeading.length}`);

  const headings = [
    ...new Set(chunks.map((c) => c.metadata.heading).filter(Boolean)),
  ] as string[];
  console.log(`  distinct headings (${headings.length}):`);
  for (const heading of headings.slice(0, 40)) {
    console.log(`    - ${heading}`);
  }
  if (headings.length > 40) {
    console.log(`    ... and ${headings.length - 40} more`);
  }

  console.log(`\n  --- first 3 chunks in full ---`);
  for (const chunk of chunks.slice(0, 3)) {
    console.log(
      `\n  [page ${chunk.metadata.page}] heading=${JSON.stringify(chunk.metadata.heading)}`,
    );
    console.log(
      chunk.content
        .split("\n")
        .map((line) => `    | ${line}`)
        .join("\n")
        .slice(0, 1200),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
