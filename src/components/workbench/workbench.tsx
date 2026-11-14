"use client";

import { BookOpen, FileSearch } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { AnswerPanel } from "@/components/chat/answer-panel";
import { QueryInput } from "@/components/chat/query-input";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UploadStrip, type DocumentRow } from "@/components/workbench/upload-strip";
import { ProtocolViewer } from "@/components/viewer/protocol-viewer";
import { useChat } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/database";

/**
 * The workbench.
 *
 * One screen, two panes: the left one asks and answers, the right one
 * shows the protocol the answer came from. Nothing navigates away, so the
 * evidence and the claim stay on screen together.
 */

const SUGGESTIONS = [
  "What is the incubation time for the lysis step?",
  "How should samples be stored after preparation?",
  "What PPE is required for this procedure?",
  "What are the acceptance criteria for the assay?",
];

export function Workbench() {
  const chat = useChat();
  const [query, setQuery] = React.useState("");
  /** The question the current answer came from. */
  const [asked, setAsked] = React.useState("");
  const [documents, setDocuments] = React.useState<DocumentRow[]>([]);
  const [picked, setPicked] = React.useState<{
    documentId: string;
    citation: Citation | null;
  } | null>(null);

  const top = chat.citations[0] ?? null;

  // A new answer replaces the citation the user clicked, but not the
  // protocol they are reading: a technician comparing two SOPs should not
  // be thrown back to the first one when they ask a question.
  const answerKey = top?.id ?? null;
  const [lastAnswerKey, setLastAnswerKey] = React.useState(answerKey);
  if (answerKey !== lastAnswerKey) {
    setLastAnswerKey(answerKey);
    setPicked((previous) =>
      previous?.citation
        ? { documentId: previous.documentId, citation: null }
        : previous,
    );
  }

  const activeDocumentId =
    picked?.documentId ?? top?.documentId ?? documents[0]?.id ?? null;

  // The answer's best passage is marked only when it belongs to the
  // protocol on screen.
  const activeCitation =
    picked?.citation ??
    (top && top.documentId === activeDocumentId ? top : null);

  const loadDocuments = React.useCallback(async () => {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error("Could not load the knowledge base");
    const body = await response.json();
    const list = (body.documents ?? []) as DocumentRow[];
    setDocuments(list);

    // A removed protocol cannot stay selected.
    setPicked((previous) =>
      previous && !list.some((document) => document.id === previous.documentId)
        ? null
        : previous,
    );

    return list;
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        await loadDocuments();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not load the knowledge base",
        );
      }
    })();
  }, [loadDocuments]);

  const handleSubmit = React.useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setAsked(trimmed);
    // One protocol at a time: the question is answered from the document
    // on screen, so the evidence stays where the technician is looking.
    void chat.send(trimmed, activeDocumentId ?? undefined);
  }, [activeDocumentId, chat, query]);

  const selectCitation = React.useCallback((citation: Citation) => {
    setPicked({ documentId: citation.documentId, citation });
  }, []);

  const selectDocument = React.useCallback((documentId: string) => {
    setPicked({ documentId, citation: null });
  }, []);

  const hasAnswer = chat.answer.length > 0 || chat.citations.length > 0;

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border px-3 lg:px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <BookOpen className="size-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">CircuitAtlas</span>
        <span className="text-xs text-muted-foreground">
          {documents.length} protocol{documents.length === 1 ? "" : "s"} indexed
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-12">
        <section className="flex min-h-0 flex-col lg:col-span-5">
          <UploadStrip
            documents={documents}
            activeId={activeDocumentId}
            onChanged={loadDocuments}
            onSelect={selectDocument}
          />

          <div className="min-h-0 flex-1 px-4 py-3 lg:overflow-y-auto">
            {hasAnswer ? (
              <>
                <AnswerPanel
                  answer={chat.answer}
                  isStreaming={chat.isStreaming}
                  isLoading={chat.isLoading}
                  insufficient={chat.insufficient}
                  error={chat.error}
                  citations={chat.citations}
                  onCitationClick={selectCitation}
                  onRetry={handleSubmit}
                />

                {chat.citations.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {chat.citations.map((citation) => (
                      <button
                        key={citation.id}
                        type="button"
                        onClick={() => selectCitation(citation)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                          activeCitation?.id === citation.id
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <span className="font-mono text-[11px] text-primary">
                          [{citation.ordinal}]
                        </span>
                        <span className="max-w-40 truncate">
                          {citation.documentTitle}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums">
                          {(citation.similarity * 100).toFixed(0)}%
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <FileSearch className="size-6 text-muted-foreground/40" />
                <div>
                  <p className="text-sm font-medium">Ask the protocols</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                    Answers come only from the indexed SOPs, and the passage
                    they came from opens on the right.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setQuery(suggestion)}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border p-3">
            <QueryInput
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              isLoading={chat.isLoading}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-t border-border lg:col-span-7 lg:border-l lg:border-t-0">
          <ProtocolViewer
            documentId={activeDocumentId}
            citation={activeCitation}
            query={asked}
          />
        </section>
      </div>
    </div>
  );
}
