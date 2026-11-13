import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { CHUNK_SIZE_CHARS } from "@/lib/constants";
import { splitBySize } from "@/lib/rag/chunk";

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
 *  - Pages are grouped into chunks on the size budget. If a PDF has
 *    detectable headings (many SOPs exported from a template do), they are
 *    picked up as section boundaries so the chunk still maps to a named
 *    section. Otherwise the chunk is labelled by its page range.
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

/** A page's extracted text. */
type PageText = {
  pageNumber: number;
  text: string;
};

const HEADING_MAX_LENGTH = 90;

/**
 * Decides whether a line of extracted PDF text is a section heading.
 *
 * Heuristics, in priority order:
 *
 *  1. Top-level numbering: "3. Procedure" but NOT "3.1 Pellet the cells".
 *     In SOPs, single-level numbers are sections and dotted numbers are
 *     procedure steps. Steps must not be treated as headings or every
 *     chunk would be labelled with a step number.
 *  2. ALL CAPS: "4. SAFETY REQUIREMENTS".
 *  3. Short Title Case: "Purpose", "Acceptance Criteria".
 *
 * Deliberately conservative - a false positive means a chunk is labelled
 * with the wrong section name, which is worse than falling back to a page
 * range.
 */
function isHeadingLine(line: string): boolean {
  if (!line || line.length > HEADING_MAX_LENGTH) return false;
  // A heading is not a sentence.
  if (/[.!?;]$/.test(line)) return false;
  // Bullets and list markers are content, not headings.
  if (/^[-*\u2022]/.test(line)) return false;

  // 1. Top-level numbering only: "3. Procedure". Requires the space after
  //    the period, which excludes dotted steps like "3.1 Pellet ...".
  if (/^\d+\.\s+\S/.test(line)) return true;

  // 2. ALL CAPS.
  if (line.length >= 3 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
    return true;
  }

  // 3. Short Title Case.
  const isTitleCase =
    /^[A-Z][a-zA-Z0-9\s()\-/'".:]{2,}$/.test(line) &&
    line.split(/\s+/).filter(Boolean).length <= 8;
  return isTitleCase;
}

/**
 * Splits a page's text into sections keyed by the headings within it.
 *
 * Text before the first heading becomes an unnamed leading section.
 */
function splitPageIntoSections(text: string): Array<{
  heading: string | null;
  body: string;
}> {
  const lines = text.split("\n");
  const sections: Array<{ heading: string | null; body: string[] }> = [];

  let current: { heading: string | null; body: string[] } = {
    heading: null,
    body: [],
  };

  // A section is worth keeping if it has a heading, a body, or both.
  const hasContent = (section: {
    heading: string | null;
    body: string[];
  }) =>
    Boolean(section.heading) || section.body.join("\n").trim().length > 0;

  for (const raw of lines) {
    const line = raw.trim();
    const isHeading = isHeadingLine(line);

    if (isHeading) {
      if (hasContent(current)) {
        sections.push({ heading: current.heading, body: current.body });
      }
      current = { heading: line, body: [] };
      continue;
    }

    current.body.push(raw);
  }

  if (hasContent(current)) {
    sections.push({ heading: current.heading, body: current.body });
  }

  return sections.map((section) => {
    const body = section.body.join("\n").trim();
    // A heading with no body is still content - it is the only text on
    // some pages (a section title, a figure caption).
    return {
      heading: section.heading,
      body: body || (section.heading ?? ""),
    };
  });
}

export type PdfChunk = {
  content: string;
  metadata: {
    heading: string | null;
    section: string | null;
    page: number | null;
    pageEnd: number | null;
    ordinal: number;
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

  const { text } = await extractText(pdf, { mergePages: false });
  const pages: PageText[] = (Array.isArray(text) ? text : [text]).map(
    (pageText, index) => ({
      pageNumber: index + 1,
      text: pageText ?? "",
    }),
  );

  const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0);

  // A PDF with essentially no extractable text is almost certainly a scan.
  //
  // The threshold is per-page rather than absolute: a scanned page yields
  // zero characters, while a legitimately terse page (a title page, a
  // figure caption) still yields a handful. Only a corpus that averages
  // fewer than ~5 characters per page has no usable text layer.
  const scanThreshold = Math.max(pages.length * 5, 10);
  if (totalChars < scanThreshold) {
    throw new PdfParseError(
      "This PDF has no extractable text layer, so it appears to be a scanned image. " +
        "Scanned PDFs require OCR, which is not supported yet. " +
        "Convert the document to Markdown or text and upload that instead.",
    );
  }

  const chunks: PdfChunk[] = [];
  let ordinal = 0;

  for (const page of pages) {
    if (!page.text.trim()) continue;

    const sections = splitPageIntoSections(page.text);

    for (const section of sections) {
      if (!section.body.trim()) continue;

      // Include the heading in the chunk text so the embedding sees it.
      const withHeading = section.heading
        ? `${section.heading}\n\n${section.body}`
        : section.body;

      const pieces = splitBySize(withHeading, CHUNK_SIZE_CHARS);

      for (const piece of pieces) {
        chunks.push({
          content: piece.trim(),
          metadata: {
            heading: section.heading,
            section: section.heading,
            page: page.pageNumber,
            pageEnd: page.pageNumber,
            ordinal,
          },
        });
        ordinal++;
      }
    }
  }

  if (chunks.length === 0) {
    throw new PdfParseError("No extractable text was found in this PDF.");
  }

  return chunks;
}
