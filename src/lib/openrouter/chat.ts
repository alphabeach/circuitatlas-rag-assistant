import "server-only";

import { OPENROUTER_CHAT_MODEL } from "@/lib/constants";
import { openRouterFetch } from "@/lib/openrouter/client";

/**
 * Streaming chat completions against OpenRouter.
 *
 * Uses the OpenAI-compatible `/chat/completions` endpoint with
 * `stream: true` and parses the SSE frames manually. Going through raw
 * fetch (rather than an SDK) keeps the streaming contract explicit and
 * avoids coupling to a provider SDK's message-format assumptions.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class ChatError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ChatError";
  }
}

export type StreamChatOptions = {
  model?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
};

/**
 * Yields text deltas as they arrive.
 *
 * The generator yields string chunks. A `[DONE]` sentinel terminates the
 * stream; provider errors arrive as an `error` field inside a data frame
 * and are raised as a ChatError.
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: StreamChatOptions = {},
): AsyncGenerator<string> {
  const model = options.model ?? OPENROUTER_CHAT_MODEL;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
      "HTTP-Referer": "https://circuitatlas.local",
      "X-Title": "CircuitAtlas Protocol Assistant",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? 2000,
      temperature: options.temperature ?? 0,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ChatError(
      `Chat request failed (${response.status}): ${text.slice(0, 500)}`,
      response.status,
    );
  }

  if (!response.body) {
    throw new ChatError("Chat response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Normalise CRLF to LF so frame splitting works regardless of the
      // provider's line endings.
      buffer = buffer.replace(/\r\n/g, "\n");

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");

        if (!payload) continue;
        if (payload === "[DONE]") return;

        let parsed: {
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          // Malformed frame; skip it rather than aborting the stream.
          continue;
        }

        if (parsed.error?.message) {
          throw new ChatError(parsed.error.message);
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming completion. Used by the CLI ingest script and tests, where
 * incremental output buys nothing.
 */
export async function completeChat(
  messages: ChatMessage[],
  options: StreamChatOptions = {},
): Promise<string> {
  const model = options.model ?? OPENROUTER_CHAT_MODEL;

  const response = await openRouterFetch<{
    choices?: Array<{ message?: { content?: string } }>;
  }>("/chat/completions", {
    body: {
      model,
      messages,
      max_tokens: options.maxTokens ?? 2000,
      temperature: options.temperature ?? 0,
    },
    signal: options.signal,
  });

  return response.choices?.[0]?.message?.content ?? "";
}
