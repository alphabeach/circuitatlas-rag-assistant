import "server-only";

import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_SIZE_CHARS,
} from "@/lib/constants";

/**
 * Chunking.
 *
 * Two strategies, chosen by source type:
 *
 *  - Markdown is split on heading boundaries first, so a chunk maps to a
 *    real SOP section. Only if a single section is still too large is it
 *    broken down further by paragraph. This is the main reason Markdown
 *    input retrieves better than a flattened PDF text stream.
 *
 *  - Plain text has no structure to exploit, so it is split on blank lines
 *    with a character-based window.
 */

export type Chunk = {
  content: string;
  metadata: {
    heading: string | null;
    section: string | null;
    ordinal: number;
    [key: string]: unknown;
  };
};

type MarkdownSection = {
  heading: string | null;
  level: number;
  body: string;
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Splits Markdown into heading-delimited sections.
 *
 * The document title (the first H1, if present) becomes the section
 * heading for all content that follows it, which gives every chunk a
 * meaningful `heading` field for the citation drawer.
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];

  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentBody: string[] = [];
  let preamble: string[] = [];

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (body) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        body,
      });
    }
    currentBody = [];
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);

    if (match) {
      const level = match[1].length;
      const title = match[2].trim();

      // Content before the first heading is a preamble section.
      if (currentHeading === null && preamble.length > 0) {
        const pre = preamble.join("\n").trim();
        if (pre) {
          sections.push({ heading: null, level: 0, body: pre });
        }
        preamble = [];
      } else {
        flush();
      }

      currentHeading = title;
      currentLevel = level;
      continue;
    }

    if (currentHeading === null && currentLevel === 0) {
      preamble.push(line);
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading === null && preamble.length > 0) {
    const pre = preamble.join("\n").trim();
    if (pre) sections.push({ heading: null, level: 0, body: pre });
  } else {
    flush();
  }

  return sections;
}

/**
 * Splits a block of text into windows of at most `maxChars` characters,
 * breaking on paragraph boundaries where possible and overlapping by
 * `overlapChars` so a sentence spanning a boundary appears in both chunks.
 */
export function splitBySize(
  text: string,
  maxChars = CHUNK_SIZE_CHARS,
  overlapChars = CHUNK_OVERLAP_CHARS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const paragraph of paragraphs) {
    // A single paragraph longer than the window gets hard-split.
    if (paragraph.length > maxChars) {
      pushCurrent();
      current = "";
      for (let i = 0; i < paragraph.length; i += maxChars) {
        const slice = paragraph.slice(i, i + maxChars);
        if (i > 0) {
          const tail = previousSliceTail(paragraph, i, overlapChars);
          if (tail) chunks.push(`${tail}\n${slice}`.trim());
          else chunks.push(slice);
        } else {
          chunks.push(slice);
        }
      }
      continue;
    }

    if (current.length + paragraph.length + 2 <= maxChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    pushCurrent();

    // Start the next window with an overlap tail of the previous content.
    const tail = current.slice(-overlapChars);
    current = tail ? `${tail}\n\n${paragraph}` : paragraph;
  }

  pushCurrent();

  return chunks;
}

function previousSliceTail(text: string, index: number, overlap: number): string {
  if (overlap <= 0 || index <= 0) return "";
  return text.slice(Math.max(0, index - overlap), index);
}

/**
 * Turns a Markdown document into chunks.
 *
 * Each chunk keeps its heading so the citation drawer can show which SOP
 * section a retrieved fragment came from.
 */
export function chunkMarkdown(markdown: string): Chunk[] {
  const sections = splitMarkdownSections(markdown);
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    // Prefer preserving the heading line inside the chunk content itself,
    // so the embedding sees the section title as part of the text.
    const withHeading = section.heading
      ? `${"#".repeat(Math.max(section.level, 1))} ${section.heading}\n\n${section.body}`
      : section.body;

    const pieces = splitBySize(withHeading);

    for (const piece of pieces) {
      chunks.push({
        content: piece.trim(),
        metadata: {
          heading: section.heading,
          section: section.heading,
          ordinal,
        },
      });
      ordinal++;
    }
  }

  return chunks;
}

/** Turns a plain-text document into chunks. */
export function chunkText(text: string): Chunk[] {
  const pieces = splitBySize(text);
  return pieces.map((piece, ordinal) => ({
    content: piece.trim(),
    metadata: {
      heading: null,
      section: null,
      ordinal,
    },
  }));
}
