import "server-only";

import matter from "gray-matter";
import { INGEST } from "@/lib/constants";
import { chunkMarkdown, chunkText, type Chunk } from "@/lib/rag/chunk";

/**
 * Parsing layer.
 *
 * Markdown (.md) and plain text (.txt) only.
 *
 * PDF ingestion is deliberately out of scope for the MVP. The reason is
 * retrieval quality, not serverless capability: PDF text extraction yields
 * a flat stream where you cannot tell a procedural step from a safety
 * warning, so chunks map to arbitrary slices of a page. Markdown gives real
 * section boundaries, which means every retrieved chunk corresponds to a
 * named SOP section and the citation drawer can show which one.
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
      `Unsupported file type: ${filename}. Accepted formats: ${accepted.join(", ")}. ` +
        `Convert the document to Markdown or plain text and try again.`,
    );
    this.name = "UnsupportedFormatError";
  }
}

type Parser = (raw: string, filename: string) => ParsedDocument;

const markdownParser: Parser = (raw, filename) => {
  const { data, content } = matter(raw);

  const frontmatterTitle =
    typeof data.title === "string" ? data.title : undefined;
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  // The first H1 in the body is a better title than the filename when the
  // frontmatter does not supply one.
  const bodyHeading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  const title = frontmatterTitle ?? bodyHeading ?? filename.replace(/\.[^.]+$/, "");

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

const textParser: Parser = (raw, filename) => {
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

const PARSERS: Record<string, Parser> = {
  ".md": markdownParser,
  ".markdown": markdownParser,
  ".txt": textParser,
};

export function acceptedExtensions(): string[] {
  return [...INGEST.ACCEPTED_EXTENSIONS];
}

/**
 * Parses raw file content into a document ready for chunking and storage.
 */
export function parseDocument(raw: string, filename: string): ParsedDocument {
  const extension = extensionOf(filename);

  const parser = PARSERS[extension];
  if (!parser) {
    throw new UnsupportedFormatError(filename, INGEST.ACCEPTED_EXTENSIONS);
  }

  if (raw.length > INGEST.MAX_FILE_CHARS) {
    throw new Error(
      `File is too large (${raw.length} characters, limit ${INGEST.MAX_FILE_CHARS}).`,
    );
  }

  const parsed = parser(raw, filename);

  if (parsed.chunks.length === 0) {
    throw new Error(`No indexable content found in ${filename}.`);
  }

  return parsed;
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}
