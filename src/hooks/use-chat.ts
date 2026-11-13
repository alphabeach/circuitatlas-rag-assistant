"use client";

import * as React from "react";

import type { Citation } from "@/types/database";

export type ChatState = {
  answer: string;
  citations: Citation[];
  isLoading: boolean;
  isStreaming: boolean;
  insufficient: boolean;
  error: string | null;
};

const INITIAL_STATE: ChatState = {
  answer: "",
  citations: [],
  isLoading: false,
  isStreaming: false,
  insufficient: false,
  error: null,
};

/**
 * Drives the SSE chat endpoint.
 *
 * The stream sends `citations` before the first `delta`, so the source
 * drawer can populate while the answer is still being written.
 */
export function useChat() {
  const [state, setState] = React.useState<ChatState>(INITIAL_STATE);
  const abortRef = React.useRef<AbortController | null>(null);

  const send = React.useCallback(
    async (query: string, documentId?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        ...INITIAL_STATE,
        isLoading: true,
      });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, documentId }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => null);
          throw new Error(detail ?? `Request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        setState((previous) => ({ ...previous, isLoading: false, isStreaming: true }));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            const eventLine = frame
              .split("\n")
              .find((line) => line.startsWith("event:"));
            const dataLine = frame
              .split("\n")
              .find((line) => line.startsWith("data:"));

            if (!eventLine || !dataLine) continue;

            const event = eventLine.slice(6).trim();
            const raw = dataLine.slice(5).trim();

            let data: unknown;
            try {
              data = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event === "citations") {
              const payload = data as { citations: Citation[] };
              setState((previous) => ({
                ...previous,
                citations: payload.citations ?? [],
              }));
            } else if (event === "delta") {
              const payload = data as { text: string };
              setState((previous) => ({
                ...previous,
                answer: previous.answer + payload.text,
              }));
            } else if (event === "done") {
              const payload = data as {
                answer: string;
                citations?: Citation[];
                insufficient?: boolean;
              };
              setState((previous) => ({
                ...previous,
                answer: payload.answer ?? previous.answer,
                citations: payload.citations ?? previous.citations,
                insufficient: payload.insufficient ?? false,
                isStreaming: false,
                isLoading: false,
              }));
            } else if (event === "error") {
              const payload = data as { message: string };
              setState((previous) => ({
                ...previous,
                error: payload.message,
                isStreaming: false,
                isLoading: false,
              }));
            }
          }
        }

        setState((previous) => ({
          ...previous,
          isStreaming: false,
          isLoading: false,
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "Request failed",
          isStreaming: false,
          isLoading: false,
        }));
      }
    },
    [],
  );

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  return { ...state, send, reset };
}
