"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";

import type { Citation } from "@/types/database";

/**
 * The PDF renderer is loaded in the browser only: pdf.js wants a browser
 * environment and a worker, and there is nothing to draw before the
 * page is mounted.
 */
const PdfCanvas = dynamic(
  () => import("@/components/viewer/pdf-canvas").then((m) => m.PdfCanvas),
  { ssr: false },
);

/**
 * The protocol viewer.
 *
 * A PDF is drawn on a canvas with its text layer on top, so the cited
 * passage can be marked on the page as it was printed. Markdown and plain
 * text have no page to draw, so they are shown as the indexed text with
 * the same passage marked.
 */

type DocumentRow = {
  id: string;
  title: string;
  filename: string;
  mime_type: string | null;
  file_url: string | null;
};

type ChunkRow = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

type DocumentContent = {
  document: DocumentRow;
  chunks: ChunkRow[];
};

/**
 * Builds a pattern that matches the passage regardless of how the
 * whitespace is broken up.
 */
export function passagePattern(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped.replace(/\s+/g, "\\s+"));
}

/**
 * Words that appear in most questions and in most protocol sentences, so
 * they say nothing about which line answers the question.
 */
const STOP_WORDS = new Set([
  "the",
  "for",
  "what",
  "how",
  "and",
  "are",
  "you",
  "with",
  "does",
  "when",
  "which",
  "that",
  "this",
  "from",
  "into",
  "any",
  "all",
  "was",
  "were",
  "will",
  "should",
  "must",
  "can",
  "need",
  "use",
  "used",
  "get",
  "make",
  "our",
  "its",
  "their",
]);

/**
 * Picks the part of a chunk that answers the question.
 *
 * The chunk is the section that matched, but the answer may be in one
 * sentence of it. Every line and sentence is scored by how many of the
 * question's words it contains, and the best one is marked.
 */
export function bestPassage(chunk: string, query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

  const sentences = chunk
    .split(/(?<=[.!?:;])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) return chunk.trim();

  let best = sentences[0];
  let bestScore = -1;

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lower.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }

  return best;
}

function pageOf(chunk: ChunkRow): number | null {
  const page = chunk.metadata?.page;
  return typeof page === "number" ? page : null;
}

function isPdf(document: DocumentRow | undefined): boolean {
  if (!document) return false;
  return (
    document.mime_type === "application/pdf" ||
    document.filename.toLowerCase().endsWith(".pdf")
  );
}

export function ProtocolViewer({
  documentId,
  citation,
  query,
}: {
  documentId: string | null;
  citation: Citation | null;
  /** The question the answer came from - it picks the marked passage. */
  query: string;
}) {
  const [content, setContent] = React.useState<DocumentContent | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!documentId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/documents?id=${encodeURIComponent(documentId)}`,
        );
        if (!response.ok) throw new Error("Could not load the document");
        const body = (await response.json()) as DocumentContent;
        if (!cancelled) {
          setContent(body);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the document",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const loaded = content && content.document.id === documentId ? content : null;

  const passage = React.useMemo(
    () => (citation ? bestPassage(citation.content, query) : null),
    [citation, query],
  );

  const citationPage =
    typeof citation?.metadata?.page === "number" ? citation.metadata.page : 1;

  const pdf = loaded && isPdf(loaded.document) ? loaded.document : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {loaded
              ? loaded.document.title
              : documentId
                ? "Loading protocol"
                : "No protocol selected"}
          </p>
          {loaded && (
            <p className="truncate text-xs text-muted-foreground">
              {loaded.document.filename} · {loaded.chunks.length} sections
            </p>
          )}
        </div>
        {citation && loaded && (
          <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {pdf ? `page ${citationPage} · ` : ""}
            {(citation.similarity * 100).toFixed(0)}% match
          </p>
        )}
      </header>

      {error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : !documentId ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Upload a protocol to read it here.
        </p>
      ) : !loaded ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading protocol
        </div>
      ) : pdf ? (
        pdf.file_url ? (
          <PdfCanvas
            fileUrl={pdf.file_url}
            pageNumber={citationPage}
            passage={passage}
          />
        ) : (
          <TextView chunks={loaded.chunks} passage={passage} />
        )
      ) : (
        <TextView chunks={loaded.chunks} passage={passage} />
      )}
    </div>
  );
}

/**
 * The indexed text of a Markdown or plain text document, with the passage
 * marked.
 */
function TextView({
  chunks,
  passage,
}: {
  chunks: ChunkRow[];
  passage: string | null;
}) {
  const pattern = React.useMemo(
    () => (passage ? passagePattern(passage) : null),
    [passage],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {chunks.map((chunk) => {
        const text = chunk.content;
        const match = pattern?.exec(text) ?? null;
        const page = pageOf(chunk);

        return (
          <article key={chunk.id} className="mb-4 last:mb-0">
            {page !== null && (
              <p className="mb-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                page {page}
              </p>
            )}
            {/* shortcut: the indexed text is shown as stored, so Markdown
                syntax is visible; upgrade path is to render the chunk with
                the Markdown pipeline used for the answer. */}
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
              {match ? (
                <>
                  {text.slice(0, match.index)}
                  <mark className="rounded-xs bg-amber-300/50 px-0.5 text-foreground">
                    {match[0]}
                  </mark>
                  {text.slice(match.index + match[0].length)}
                </>
              ) : (
                text
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}
