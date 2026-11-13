"use client";

import { FileText, Hash } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/database";

/**
 * A single retrieved chunk.
 *
 * The similarity score is shown as a percentage, but the bar length is
 * scaled against the top-scoring citation rather than against 1.0. Because
 * cosine scores on text-embedding-3-small cluster in a narrow high band, a
 * bar scaled to 1.0 would render every card as nearly full and communicate
 * nothing.
 */
export function SourceCard({
  citation,
  isBest = false,
  className,
}: {
  citation: Citation;
  isBest?: boolean;
  className?: string;
}) {
  const confidence = Math.round(citation.similarity * 100);

  // PDF chunks carry a page number, which is more useful for verification
  // than the filename alone.
  const page =
    typeof citation.metadata?.page === "number" ? citation.metadata.page : null;
  const pageLabel = page
    ? `${citation.filename} - page ${page}`
    : null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background/60 p-4 transition-colors hover:border-primary/30",
        isBest && "border-primary/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-primary">
              S{citation.ordinal}
            </span>
            <p className="truncate text-sm font-medium">
              {citation.documentTitle}
            </p>
          </div>

          {citation.heading && (
            <p className="mt-1.5 flex items-center gap-1.5 truncate pl-7 text-xs text-muted-foreground">
              <Hash className="size-3 shrink-0" />
              {citation.heading}
            </p>
          )}

          {pageLabel && (
            <p className="mt-1 flex items-center gap-1.5 pl-7 text-xs text-muted-foreground">
              <FileText className="size-3 shrink-0" />
              {pageLabel}
            </p>
          )}

          {!pageLabel && (
            <p className="mt-1 flex items-center gap-1.5 pl-7 text-xs text-muted-foreground">
              <FileText className="size-3 shrink-0" />
              {citation.filename}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold tabular-nums">
            {confidence}%
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            match
          </p>
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isBest ? "bg-primary" : "bg-primary/50",
          )}
          style={{ width: `${Math.max(confidence, 3)}%` }}
        />
      </div>

      <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-t border-border pt-3 font-sans text-xs leading-relaxed text-muted-foreground">
        {citation.content}
      </pre>

      {isBest && (
        <Badge variant="default" className="mt-3">
          Top match
        </Badge>
      )}
    </div>
  );
}
