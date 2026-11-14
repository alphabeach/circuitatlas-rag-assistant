"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/database";

export type AnswerPanelProps = {
  answer: string;
  isStreaming?: boolean;
  isLoading?: boolean;
  insufficient?: boolean;
  error?: string | null;
  citations?: Citation[];
  onCitationClick?: (citation: Citation) => void;
  onRetry?: () => void;
  className?: string;
};

/**
 * Renders the AI answer.
 *
 * When the model returns the INSUFFICIENT_CONTEXT sentinel we show a
 * distinct "not found" state instead of the raw marker text, because the
 * raw output looks like an error to the user.
 *
 * The markers the model writes ("[S1]") become buttons. The marker is
 * rewritten into a Markdown link first, because Markdown has no way to
 * attach an event handler to a run of text.
 */
export function AnswerPanel({
  answer,
  isStreaming = false,
  isLoading = false,
  insufficient = false,
  error,
  citations = [],
  onCitationClick,
  onRetry,
  className,
}: AnswerPanelProps) {
  if (error) {
    return (
      <div
        className={cn(
          "rounded-lg border border-destructive/40 bg-destructive/10 p-4",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-destructive">
              Something went wrong
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 text-sm text-primary underline-offset-4 hover:underline"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Searching the protocol corpus...
        </div>
        <div className="space-y-2">
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-9/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (insufficient) {
    return (
      <div
        className={cn(
          "rounded-lg border border-warning/30 bg-warning/5 p-4",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium">Not found in the ingested SOPs</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The retrieved protocol sections do not cover this question. Upload
              the relevant SOP, or rephrase the question using the terminology
              used in the protocol.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!answer) return null;

  const linkified = answer.replace(
    /\[S(\d+)\]/g,
    (_match, ordinal: string) => `[[${ordinal}]](#cite-${ordinal})`,
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="prose-answer text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Protocol tables are the densest thing an SOP contains, so
            // they get their own renderer: fixed column alignment and a
            // monospaced cell so values line up like a printed table.
            table: ({ children }) => (
              <div className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-xs font-mono">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="border-b border-border">{children}</thead>
            ),
            tr: ({ children }) => <tr>{children}</tr>,
            th: ({ children }) => (
              <th className="border border-border px-2.5 py-1.5 text-left align-top font-medium">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-2.5 py-1.5 text-left align-top">
                {children}
              </td>
            ),
            a: ({ href, children }) => {
              const marker = href?.match(/^#cite-(\d+)$/);
              if (!marker) return <a href={href}>{children}</a>;

              const ordinal = Number(marker[1]);
              const citation = citations.find(
                (item) => item.ordinal === ordinal,
              );

              return (
                <button
                  type="button"
                  onClick={() => citation && onCitationClick?.(citation)}
                  title={
                    citation
                      ? `${citation.documentTitle} - ${(citation.similarity * 100).toFixed(0)}% match`
                      : undefined
                  }
                  className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded border border-primary/40 bg-primary/15 px-1 font-mono text-[11px] leading-5 text-primary transition-colors hover:bg-primary/30"
                >
                  {children}
                </button>
              );
            },
          }}
        >
          {linkified}
        </ReactMarkdown>
      </div>
      {isStreaming && (
        <Badge variant="outline" className="gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          Streaming
        </Badge>
      )}
    </div>
  );
}
