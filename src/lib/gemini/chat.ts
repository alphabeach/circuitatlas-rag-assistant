import "server-only";

import { GEMINI_CHAT_FALLBACK_MODEL, GEMINI_CHAT_MODEL } from "@/lib/constants";
import { requireEnv } from "@/lib/env";
import { GeminiError, readableError, withRetry } from "@/lib/gemini/client";

/**
 * Gemini streaming chat.
 *
 * Uses the SSE `streamGenerateContent` endpoint. Gemini models emit
 * "thought" parts alongside content parts when thinking is enabled, so
 * those are filtered out of the stream.
 */

export type GeminiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class GeminiChatError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeminiChatError";
  }
}

export type StreamChatOptions = {
  model?: string;
  /** Used when the primary model fails. */
  fallbackModel?: string | null;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
};

export async function* streamChatGemini(
  messages: GeminiChatMessage[],
  options: StreamChatOptions = {},
): AsyncGenerator<string> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const model = options.model ?? GEMINI_CHAT_MODEL;
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const body = JSON.stringify({
    ...(systemText
      ? { systemInstruction: { parts: [{ text: systemText }] } }
      : {}),
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0,
      maxOutputTokens: options.maxTokens ?? 2000,
    },
  });

  /**
   * Fetch the stream, throwing on a non-OK response.
   *
   * The throw has to happen inside the retried function - returning a 503
   * Response and checking it afterwards would never trigger a retry.
   */
  const fetchStream = async (modelId: string): Promise<Response> => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
        signal: options.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GeminiChatError(
        readableError(response.status, text),
        response.status,
      );
    }

    return response;
  };

  // The free tier serves flash models from a shared pool that returns 503
  // ("high demand") fairly often, and 429 when the per-minute quota is hit.
  // Both are worth retrying.
  const retry = {
    attempts: 4,
    baseDelayMs: 2000,
    isRetryable: (error: unknown) =>
      error instanceof GeminiChatError &&
      (error.status === 429 ||
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503 ||
        error.status === 504),
  };

  let response: Response;
  try {
    response = await withRetry(() => fetchStream(model), retry);
  } catch (error) {
    // The primary model can be busy or not enabled for the account. The
    // fallback is a different pool, so it is worth one more try.
    const fallback = options.fallbackModel ?? GEMINI_CHAT_FALLBACK_MODEL;
    if (!fallback || fallback === model) throw error;

    response = await withRetry(() => fetchStream(fallback), retry);
  }

  if (!response.body) {
    throw new GeminiChatError("Gemini chat response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Normalise CRLF to LF. Gemini's SSE frames are separated by
      // "\r\n\r\n", and splitting on "\n\n" alone never matches that - the
      // stream would parse as zero frames and yield an empty answer with no
      // error. JSON payloads escape their own newlines, so this is safe.
      buffer = buffer.replace(/\r\n/g, "\n");

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

        if (!payload || payload === "[DONE]") continue;

        let parsed: {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          }>;
          error?: { code?: number; message?: string; status?: string };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.error) {
          // In-stream failures carry the same JSON shape as a failed
          // response, including the numeric HTTP-ish code.
          throw new GeminiError(
            readableError(parsed.error.code ?? 500, payload),
            parsed.error.code ?? 500,
            payload,
          );
        }

        for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
          // Skip the model's internal reasoning, which Gemini emits as
          // parts flagged with `thought`.
          if (part.thought) continue;
          if (part.text) yield part.text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
