/**
 * Investigates font sizes in a real PDF to find the heading signal.
 *
 * Line-pattern heuristics cannot tell a section title from a numbered
 * procedure step. Font size can, because headings are physically set
 * larger than body text.
 *
 * Usage: npx tsx scripts/inspect-fonts.ts <path.pdf> [maxPages]
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { extractTextItems, getDocumentProxy } from "unpdf";

async function main() {
  const file = process.argv[2];
  const maxPages = Number(process.argv[3] ?? 6);

  if (!file) {
    console.error("Usage: npx tsx scripts/inspect-fonts.ts <path.pdf>");
    process.exit(1);
  }

  const buffer = new Uint8Array(readFileSync(file));
  const pdf = await getDocumentProxy(buffer);
  // Pass the document proxy, not the buffer: getDocumentProxy detaches the
  // ArrayBuffer it was given.
  const { items } = await extractTextItems(pdf);

  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`  pages: ${pdf.numPages}, item pages: ${items.length}\n`);

  // Histogram of font sizes across the sampled pages.
  const histogram = new Map<number, number>();

  for (const pageItems of items.slice(0, maxPages)) {
    for (const item of pageItems) {
      const size = Math.round(item.fontSize * 10) / 10;
      histogram.set(size, (histogram.get(size) ?? 0) + 1);
    }
  }

  const sizes = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  console.log("  font size histogram (size -> item count):");
  for (const [size, count] of sizes.slice(0, 15)) {
    console.log(`    ${String(size).padStart(6)} -> ${count}`);
  }

  // Show the largest-font lines on each sampled page.
  console.log("\n  --- largest-text lines per page ---");

  for (let pageIndex = 0; pageIndex < Math.min(maxPages, items.length); pageIndex++) {
    const pageItems = items[pageIndex];

    // Group items into lines by their y coordinate.
    const lines = new Map<number, typeof pageItems>();
    for (const item of pageItems) {
      const key = Math.round(item.y);
      const existing = lines.get(key);
      if (existing) existing.push(item);
      else lines.set(key, [item]);
    }

    const rendered = [...lines.entries()]
      .map(([y, lineItems]) => ({
        y,
        text: lineItems
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join("")
          .trim(),
        fontSize: Math.max(...lineItems.map((i) => i.fontSize)),
      }))
      .filter((line) => line.text.length > 0)
      .sort((a, b) => b.fontSize - a.fontSize);

    console.log(`\n  page ${pageIndex + 1}:`);
    for (const line of rendered.slice(0, 6)) {
      console.log(
        `    size=${line.fontSize.toFixed(1).padStart(5)}  ${line.text.slice(0, 85)}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
