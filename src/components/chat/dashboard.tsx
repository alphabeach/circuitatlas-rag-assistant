"use client";

import { Database, FileSearch, Sparkles } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { AnswerPanel } from "@/components/chat/answer-panel";
import { QueryInput } from "@/components/chat/query-input";
import { CitationDrawer } from "@/components/citations/citation-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useChat } from "@/hooks/use-chat";

const SUGGESTIONS = [
  "What is the incubation time for the lysis step?",
  "How should samples be stored after preparation?",
  "What PPE is required for this procedure?",
  "What are the acceptance criteria for the assay?",
];

export function Dashboard() {
  const [query, setQuery] = React.useState("");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const chat = useChat();

  const handleSubmit = React.useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setDrawerOpen(false);
    void chat.send(trimmed);
  }, [chat, query]);

  const hasAnswer = chat.answer.length > 0 || chat.citations.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 lg:py-12">
      <div className="mb-8 space-y-2">
        <Badge variant="outline" className="gap-1.5">
          <Sparkles className="size-3" />
          Retrieval-augmented protocol assistant
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">
          What does the protocol say?
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ask about assays, procedures, or safety requirements. Answers are
          generated strictly from the ingested SOPs and cite the exact sections
          they came from.
        </p>
      </div>

      <QueryInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        isLoading={chat.isLoading}
        suggestions={SUGGESTIONS}
      />

      {(hasAnswer || chat.error) && (
        <section className="mt-8 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Answer</h2>

            {chat.citations.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawerOpen(true)}
                className="gap-1.5"
              >
                <FileSearch className="size-3.5" />
                {chat.citations.length} source
                {chat.citations.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>

          <AnswerPanel
            answer={chat.answer}
            isStreaming={chat.isStreaming}
            isLoading={chat.isLoading}
            insufficient={chat.insufficient}
            error={chat.error}
            onRetry={handleSubmit}
          />

          {chat.citations.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-3">
              <Database className="size-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Grounded in{" "}
                {new Set(chat.citations.map((c) => c.documentTitle)).size}{" "}
                document
                {new Set(chat.citations.map((c) => c.documentTitle)).size === 1
                  ? ""
                  : "s"}
                . Top match{" "}
                <span className="font-mono text-foreground">
                  {(chat.citations[0].similarity * 100).toFixed(1)}%
                </span>
                .
              </p>
            </div>
          )}
        </section>
      )}

      {!hasAnswer && !chat.error && (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-14 text-center">
          <FileSearch className="size-7 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">No protocol corpus loaded</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Upload your Markdown or text SOPs to make them searchable. Answers
              are only ever grounded in ingested protocols.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="mt-1">
            <Link href="/upload">Upload protocols</Link>
          </Button>
        </div>
      )}

      <CitationDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        citations={chat.citations}
      />
    </div>
  );
}
