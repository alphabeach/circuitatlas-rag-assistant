import "server-only";

import matter from "gray-matter";
import { INGEST } from "@/lib/constants";
import { chunkMarkdown, chunkText, type Chunk } from "@/lib/rag/chunk";
import { parsePdf, PdfParseError } from "@/lib/parsers/pdf";

/**
 * Parsing layer.
 *
 * Supported: Markdown (.md), plain text (.txt), PDF (.pdf).
 *
 * Markdown is the best format for retrieval because headings become real
 * chunk boundaries, but PDF is supported for the practical reason that
 * existing SOPs are PDFs. PDF chunks are page-aware (a citation points at a
 * page) and use heuristic heading detection to recover section boundaries
 * where the text layer allows it.
 *
 * This is a registry. Adding a format later means adding one file and
 * registering it below - no changes to the ingest route.
 */

export type ParsedDocument = {
  title: string;
  content: string;
  chunks: Chunk[];
  tags: string[];
  metadata: Record<string, unknown>;
};

export class UnsupportedFormatError extends Error {
  constructor(filename: string, accepted: readonly string[]) {
    super(
      `Unsupported file type: ${filename}. Accepted formats: ${accepted.join(", ")}.`,
    );
    this.name = "UnsupportedFormatError";
  }
}

export { PdfParseError };

type TextParser = (raw: string, filename: string) => ParsedDocument;

const markdownParser: TextParser = (raw, filename) => {
  const { data, content } = matter(raw);

  const frontmatterTitle =
    typeof data.title === "string" ? data.title : undefined;
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  // The first H1 in the body is a better title than the filename when the
  // frontmatter does not supply one.
  const bodyHeading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  const title =
    frontmatterTitle ?? bodyHeading ?? filename.replace(/\.[^.]+$/, "");

  return {
    title,
    content: content.trim(),
    chunks: chunkMarkdown(content),
    tags,
    metadata: {
      frontmatter: data,
      ...(bodyHeading ? { bodyHeading } : {}),
    },
  };
};

const textParser: TextParser = (raw, filename) => {
  const content = raw.trim();
  const firstLine = content.split("\n")[0]?.trim();
  const title =
    firstLine && firstLine.length <= 120
      ? firstLine.replace(/^#+\s*/, "")
      : filename.replace(/\.[^.]+$/, "");

  return {
    title,
    content,
    chunks: chunkText(content),
    tags: [],
    metadata: {},
  };
};

const TEXT_PARSERS: Record<string, TextParser> = {
  ".md": markdownParser,
  ".markdown": markdownParser,
  ".txt": textParser,
};

/**
 * Parses raw file content into a document ready for chunking and storage.
 *
 * Handles binary (PDF) and text formats. Binary content must be passed as
 * bytes; text content as a string.
 */
export async function parseDocument(
  input: string | Uint8Array,
  filename: string,
  mimeType?: string,
): Promise<ParsedDocument> {
  const extension = extensionOf(filename);
  const isPdf =
    extension === ".pdf" || mimeType === "application/pdf";

  if (isPdf) {
    if (typeof input === "string") {
      throw new PdfParseError(
        "PDF content must be provided as binary data, not as text.",
      );
    }

    const chunks = await parsePdf(input);

    return {
      title: filename.replace(/\.[^.]+$/, ""),
      content: chunks.map((chunk) => chunk.content).join("\n\n"),
      chunks,
      tags: [],
      metadata: { pageCount: chunks.length, format: "pdf" },
    };
  }

  const parser = TEXT_PARSERS[extension];
  if (!parser) {
    throw new UnsupportedFormatError(filename, INGEST.ACCEPTED_EXTENSIONS);
  }

  if (typeof input !== "string") {
    throw new UnsupportedFormatError(filename, INGEST.ACCEPTED_EXTENSIONS);
  }

  if (input.length > INGEST.MAX_FILE_CHARS) {
    throw new Error(
      `File is too large (${input.length} characters, limit ${INGEST.MAX_FILE_CHARS}).`,
    );
  }

  const parsed = parser(input, filename);

  if (parsed.chunks.length === 0) {
    throw new Error(`No indexable content found in ${filename}.`);
  }

  return parsed;
}

export function acceptedExtensions(): string[] {
  return [...INGEST.ACCEPTED_EXTENSIONS];
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}
