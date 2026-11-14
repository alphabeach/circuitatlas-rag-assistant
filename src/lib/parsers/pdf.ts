import "server-only";

import { extractTextItems, getDocumentProxy } from "unpdf";

import { CHUNK_SIZE_CHARS } from "@/lib/constants";
import type { PdfRect } from "@/types/database";

/**
 * PDF parsing.
 *
 * PDF extraction produces a flat text stream with no heading structure, so
 * the chunking strategy differs from Markdown:
 *
 *  - Text is extracted per page, and the page number is preserved in chunk
 *    metadata. A citation can then point at "page 7" instead of an
 *    arbitrary byte offset, which is what a technician needs to verify a
 *    claim against a printed SOP.
 *
 *  - Every chunk also keeps the RECTANGLES of the lines it contains, in
 *    PDF points. That is what lets the UI draw the answer on the page
 *    itself instead of showing a list of text snippets.
 *
 *  - Headings are detected from FONT SIZE, not from text patterns.
 *
 * Why font size: a line-pattern heuristic cannot tell a section title from
 * a numbered procedure step. In a real SOP, "AUTOCLAVE" and
 * "3. All samples must be wrapped in appropriate material" both look like
 * short lines starting with a digit - but the first is set at 14pt and the
 * second at 11pt, the same size as its surrounding body text. Font size is
 * the signal a human uses, so it is the signal the parser uses.
 *
 * The body size is computed PER PAGE, because it varies between sections:
 * in one real SOP the body is 14pt on the introduction, 12pt in the safety
 * section and 11pt in the instrument procedures. A global threshold would
 * either miss every heading in the 11pt section or label the whole 14pt
 * introduction as headings.
 *
 * Scanned/image-only PDFs have no text layer. Those are detected and
 * rejected with a clear message rather than silently producing empty
 * chunks.
 */

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfParseError";
  }
}

/** A reconstructed line of text with the font size it was set at. */
type PageLine = {
  text: string;
  fontSize: number;
  /** Vertical position of the baseline, in PDF coordinates (origin bottom-left). */
  y: number;
  /** The area the line's glyphs occupy, in PDF points. */
  rect: PdfRect;
};

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  dir: string;
  hasEOL: boolean;
};

const HEADING_MAX_LENGTH = 120;

/**
 * A line counts as a heading when it is set at least this many points
 * larger than the page's body text.
 *
 * 1.5pt, not half a point: in a real SOP the body is 11pt and the step
 * titles ("1) INSPECT THE OVEN") are 12pt - one point up, and they are
 * steps, not sections. Real section titles sit two to four points above
 * the body. A half-point tolerance turned every step into a section.
 */
const HEADING_SIZE_EPSILON = 1.5;

/**
 * A line is treated as page furniture (a running header or footer) when it
 * sits in the outer 8% of the page's text block.
 */
const FURNITURE_BAND = 0.08;

/**
 * A repeated line is only treated as furniture once it has appeared on at
 * least this many pages. Three is enough to distinguish a running header
 * from a legitimately repeated line.
 */
const FURNITURE_MIN_PAGES = 3;

/** Bullet and list markers that indicate a body line, not a heading. */
const BULLET_RE = /^[-*\u2022\u2013\u00b7\u25cf\u25aa\u2043]/;

/**
 * How much of the font size sits below the baseline.
 *
 * PDF.js reports the baseline and the font size, not the glyph box, so the
 * box is approximated from the font metrics: most fonts put roughly a
 * quarter of the em below the baseline and the rest above it.
 */
const DESCENT_RATIO = 0.22;

/**
 * Reconstructs lines from positioned text items.
 *
 * Uses PDF.js's own `hasEOL` signal rather than grouping by y coordinate,
 * because y-grouping merges the columns of a two-column layout into
 * interleaved single lines.
 */
function buildLines(items: TextItem[]): PageLine[] {
  const lines: PageLine[] = [];

  let parts: string[] = [];
  let maxFontSize = 0;
  let y = 0;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let fontSize = 0;

  const flush = () => {
    const text = parts.join("").trim();
    if (text) {
      lines.push({
        text,
        fontSize: maxFontSize,
        y,
        rect: {
          x: round(left),
          y: round(y - fontSize * DESCENT_RATIO),
          width: round(right - left),
          height: round(fontSize),
        },
      });
    }
    parts = [];
    maxFontSize = 0;
    y = 0;
    left = Number.POSITIVE_INFINITY;
    right = Number.NEGATIVE_INFINITY;
    fontSize = 0;
  };

  for (const item of items) {
    if (item.str) {
      parts.push(item.str);
      if (item.fontSize > maxFontSize) maxFontSize = item.fontSize;
      if (item.height > fontSize) fontSize = item.height;
      // The baseline comes from the first item of the line; the other items
      // of the line share it.
      if (parts.length === 1) y = item.y;
      left = Math.min(left, item.x);
      right = Math.max(right, item.x + item.width);
    }
    if (item.hasEOL) flush();
  }

  // A final line without a trailing EOL marker.
  flush();

  return lines;
}

/** Rounds to two decimals - enough for a highlight, small enough for jsonb. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normalises text so "3Foo" and "3 Foo" compare equal. */
function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The key a line is compared by when hunting for running furniture.
 *
 * Page numbers are dropped: "Page 1", "Page 2" and "Page 3" are the same
 * running header, but as written they never match each other, so the
 * header survives on every page.
 */
function furnitureKey(text: string): string {
  return normalizeForComparison(text.replace(/\d+/g, ""));
}

/**
 * Finds running headers and footers.
 *
 * Real documents repeat a header on every page - "Laboratory Safety Policies
 * and Standard Operating Procedures 2024" with the page number glued to the
 * front. Left alone, each one is detected as a heading and splits the page
 * into a useless section.
 *
 * A line qualifies when it sits in the outer band of the page's text block
 * and the same text appears on several pages.
 */
function findRunningFurniture(
  pageLines: PageLine[][],
): Set<string> {
  const occurrences = new Map<string, Set<number>>();

  pageLines.forEach((lines, pageIndex) => {
    if (lines.length === 0) return;

    const ys = lines.map((line) => line.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY;
    if (span <= 0) return;

    const band = span * FURNITURE_BAND;

    for (const line of lines) {
      const inHeader = line.y >= maxY - band;
      const inFooter = line.y <= minY + band;
      if (!inHeader && !inFooter) continue;

      const key = furnitureKey(line.text);
      if (!key) continue;

      const pages = occurrences.get(key) ?? new Set<number>();
      pages.add(pageIndex);
      occurrences.set(key, pages);
    }
  });

  const furniture = new Set<string>();
  for (const [key, pages] of occurrences) {
    if (pages.size >= FURNITURE_MIN_PAGES) {
      furniture.add(key);
    }
  }

  return furniture;
}

/**
 * The body font size for a page: the size covering the most characters.
 *
 * Weighted by character count rather than counting lines, because a page
 * with a two-line heading and forty lines of body text should report the
 * body size, not the heading size.
 */
function bodyFontSize(lines: PageLine[]): number {
  const weights = new Map<number, number>();

  for (const line of lines) {
    const key = Math.round(line.fontSize * 2) / 2;
    weights.set(key, (weights.get(key) ?? 0) + line.text.length);
  }

  let bestSize = lines[0]?.fontSize ?? 0;
  let bestWeight = -1;

  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestSize = size;
    }
  }

  return bestSize;
}

/** A run of lines that belong to one section. */
type PageSection = {
  heading: string | null;
  lines: PageLine[];
};

/**
 * A page's lines, split into sections at heading boundaries.
 *
 * A line is a heading when its font size exceeds the page's body size.
 * The heading line itself is the first line of its section, so the text is
 * stored once and the highlight covers the title as well as the body.
 */
function splitPageIntoSections(lines: PageLine[]): PageSection[] {
  const bodySize = bodyFontSize(lines);

  const sections: PageSection[] = [];
  let current: PageSection = { heading: null, lines: [] };

  for (const line of lines) {
    const isHeading =
      line.fontSize > bodySize + HEADING_SIZE_EPSILON &&
      line.text.length <= HEADING_MAX_LENGTH &&
      // A bulleted line is body text that happens to be set slightly
      // larger, not a section heading.
      !BULLET_RE.test(line.text);

    if (isHeading) {
      if (current.heading || current.lines.length > 0) sections.push(current);
      current = { heading: line.text, lines: [line] };
      continue;
    }

    current.lines.push(line);
  }

  sections.push(current);

  return sections;
}

/**
 * Packs lines into chunks of at most `maxChars` characters.
 *
 * Lines are never split, so every chunk keeps a known set of rectangles
 * and the highlight lands exactly on the text that was embedded.
 */
function packLines(lines: PageLine[], maxChars: number): PageLine[][] {
  const packs: PageLine[][] = [];
  let current: PageLine[] = [];
  let length = 0;

  for (const line of lines) {
    const cost = line.text.length + 1;
    if (current.length > 0 && length + cost > maxChars) {
      packs.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += cost;
  }

  if (current.length > 0) packs.push(current);

  return packs;
}

export type PdfChunk = {
  content: string;
  metadata: {
    heading: string | null;
    section: string | null;
    page: number | null;
    pageEnd: number | null;
    ordinal: number;
    /** Where the chunk's lines sit on the page, in PDF points. */
    rects: PdfRect[];
  };
};

/**
 * Extracts text from a PDF and returns page-aware chunks.
 */
export async function parsePdf(buffer: Uint8Array): Promise<PdfChunk[]> {
  let pdf;
  try {
    pdf = await getDocumentProxy(buffer);
  } catch (error) {
    throw new PdfParseError(
      `Could not read the PDF: ${
        error instanceof Error ? error.message : "the file appears to be corrupt"
      }`,
    );
  }

  const pageCount = pdf.numPages;

  // Guard against pathological files before doing the work.
  if (pageCount > 500) {
    throw new PdfParseError(
      `This PDF has ${pageCount} pages, which exceeds the 500-page limit for ingestion.`,
    );
  }

  // Pass the document proxy rather than the buffer: getDocumentProxy
  // detaches the ArrayBuffer it is given.
  const { items: pagesOfItems } = await extractTextItems(pdf);

  const pageLines: PageLine[][] = pagesOfItems.map((items) =>
    buildLines(items as TextItem[]),
  );

  // Drop running headers and footers before anything else, so they are
  // neither mistaken for headings nor embedded in chunk text.
  const furniture = findRunningFurniture(pageLines);
  const contentLines: PageLine[][] =
    furniture.size === 0
      ? pageLines
      : pageLines.map((lines) =>
          lines.filter((line) => !furniture.has(furnitureKey(line.text))),
        );

  const totalChars = contentLines.reduce(
    (sum, lines) => sum + lines.reduce((n, line) => n + line.text.length, 0),
    0,
  );

  // A PDF with essentially no extractable text is almost certainly a scan.
  //
  // The threshold is per-page rather than absolute: a scanned page yields
  // zero characters, while a legitimately terse page (a title page, a
  // figure caption) still yields a handful. Only a corpus that averages
  // fewer than ~5 characters per page has no usable text layer.
  const scanThreshold = Math.max(contentLines.length * 5, 10);
  if (totalChars < scanThreshold) {
    throw new PdfParseError(
      "This PDF has no extractable text layer, so it appears to be a scanned image. " +
        "Scanned PDFs require OCR, which is not supported yet. " +
        "Convert the document to Markdown or text and upload that instead.",
    );
  }

  const chunks: PdfChunk[] = [];
  let ordinal = 0;

  contentLines.forEach((lines, pageIndex) => {
    const pageNumber = pageIndex + 1;
    if (lines.length === 0) return;

    const sections = splitPageIntoSections(lines);

    for (const section of sections) {
      if (section.lines.length === 0) continue;

      for (const pack of packLines(section.lines, CHUNK_SIZE_CHARS)) {
        const content = pack
          .map((line) => line.text)
          .join("\n")
          .trim();
        if (!content) continue;

        chunks.push({
          content,
          metadata: {
            heading: section.heading,
            section: section.heading,
            page: pageNumber,
            pageEnd: pageNumber,
            ordinal,
            rects: pack.map((line) => line.rect),
          },
        });
        ordinal++;
      }
    }
  });

  if (chunks.length === 0) {
    throw new PdfParseError("No extractable text was found in this PDF.");
  }

  return chunks;
}
