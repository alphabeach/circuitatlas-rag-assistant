import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parsePdf, PdfParseError } from "@/lib/parsers/pdf";
import { CHUNK_SIZE_CHARS } from "@/lib/constants";

/**
 * PDF parser tests.
 *
 * Uses a small PDF fixture generated at build time in `tests/fixtures/`.
 */

const FIXTURE = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "sample.pdf",
);

const SOP_FIXTURE = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "sop-sample.pdf",
);

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE));
}

function loadSopFixture(): Uint8Array {
  return new Uint8Array(readFileSync(SOP_FIXTURE));
}

describe("parsePdf", () => {
  it("extracts text from a PDF", async () => {
    const chunks = await parsePdf(loadFixture());

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("Dummy PDF file");
  });

  it("records the page number in chunk metadata", async () => {
    const chunks = await parsePdf(loadFixture());

    expect(chunks[0].metadata.page).toBe(1);
    expect(chunks[0].metadata.ordinal).toBe(0);
  });

  it("rejects a file that is not a valid PDF", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    await expect(parsePdf(garbage)).rejects.toThrow(PdfParseError);
  });
});

describe("parsePdf with a realistic SOP", () => {
  it("extracts text across all pages", async () => {
    const chunks = await parsePdf(loadSopFixture());

    const all = chunks.map((c) => c.content).join("\n");
    expect(all).toContain("Cell Lysis and Protein Extraction");
    expect(all).toContain("SAFETY REQUIREMENTS");
    expect(all).toContain("Acceptance Criteria");
  });

  it("assigns the correct page to each chunk", async () => {
    const chunks = await parsePdf(loadSopFixture());

    const pages = new Set(chunks.map((c) => c.metadata.page));
    expect(pages).toEqual(new Set([1, 2, 3]));

    const pageTwo = chunks.filter((c) => c.metadata.page === 2);
    expect(pageTwo.length).toBeGreaterThan(0);
    expect(pageTwo[0].content).toContain("Procedure");
  });

  it("detects numbered and all-caps headings", async () => {
    const chunks = await parsePdf(loadSopFixture());

    const headings = chunks
      .map((c) => c.metadata.heading)
      .filter((h): h is string => Boolean(h));

    expect(headings).toContain("4. SAFETY REQUIREMENTS");
    expect(headings).toContain("3. Procedure");
    expect(headings).toContain("5. Acceptance Criteria");
  });

  it("does not mistake numbered procedure steps for headings", async () => {
    const chunks = await parsePdf(loadSopFixture());

    const headings = chunks
      .map((c) => c.metadata.heading)
      .filter((h): h is string => Boolean(h));

    // "3.1 Pellet the cells..." is a step, not a section.
    expect(headings.some((h) => h.startsWith("3.1"))).toBe(false);
  });

  it("keeps every chunk non-empty and within the size budget", async () => {
    const chunks = await parsePdf(loadSopFixture());

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_SIZE_CHARS);
    }
  });

  it("assigns sequential ordinals", async () => {
    const chunks = await parsePdf(loadSopFixture());

    expect(chunks.map((c) => c.metadata.ordinal)).toEqual(
      chunks.map((_, index) => index),
    );
  });
});
