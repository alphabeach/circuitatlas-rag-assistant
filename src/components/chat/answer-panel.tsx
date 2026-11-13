"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AnswerPanelProps = {
  answer: string;
  isStreaming?: boolean;
  isLoading?: boolean;
  insufficient?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
};

/**
 * Renders the AI answer.
 *
 * When the model returns the INSUFFICIENT_CONTEXT sentinel we show a
 * distinct "not found" state instead of the raw marker text, because the
 * raw output looks like an error to the user.
 */
export function AnswerPanel({
  answer,
  isStreaming = false,
  isLoading = false,
  insufficient = false,
  error,
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

  return (
    <div className={cn("space-y-3", className)}>
      <div className="prose-answer text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
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
