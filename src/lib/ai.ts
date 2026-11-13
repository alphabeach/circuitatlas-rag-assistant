import "server-only";

import {
  embedBatch as embedBatchOpenRouter,
  embedQuery as embedQueryOpenRouter,
} from "@/lib/openrouter/embeddings";
import { streamChat as streamChatOpenRouter, type ChatMessage } from "@/lib/openrouter/chat";
import {
  embedBatchGemini,
  type EmbeddingTask,
} from "@/lib/gemini/embeddings";
import { streamChatGemini } from "@/lib/gemini/chat";

/**
 * Provider-agnostic entry points for embeddings and chat.
 *
 * Two providers are supported:
 *
 *  - `gemini`  - Google AI Studio free tier. No credit card required.
 *                Recommended default: OpenRouter's free-model pool is
 *                capped at 50 requests per day on a zero-credit account,
 *                which cannot support ingesting a document plus serving
 *                queries.
 *
 *  - `openrouter` - OpenRouter. Use this with a paid key for a wider
 *                model choice, or with the free models for light use.
 *
 * Selected with the AI_PROVIDER environment variable.
 */

export type Provider = "gemini" | "openrouter";

export function getProvider(): Provider {
  const configured = process.env.AI_PROVIDER?.toLowerCase();
  if (configured === "openrouter") return "openrouter";
  if (configured === "gemini") return "gemini";
  return "gemini";
}

/**
 * Embeds a batch of texts.
 *
 * The `task` argument only applies to Gemini, which has task-specific
 * embedding models. OpenRouter has a single retrieval space.
 */
export async function embedBatch(
  input: string[],
  task: EmbeddingTask = "document",
): Promise<number[][]> {
  if (getProvider() === "openrouter") {
    return embedBatchOpenRouter(input);
  }
  return embedBatchGemini(input, task);
}

/** Embeds a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  if (getProvider() === "openrouter") {
    return embedQueryOpenRouter(text);
  }

  const [vector] = await embedBatchGemini([text], "query");
  if (!vector) throw new Error("Query embedding produced no vector");
  return vector;
}

/** Streams a chat completion. */
export async function* streamChat(
  messages: ChatMessage[],
  options: { signal?: AbortSignal; maxTokens?: number; temperature?: number } = {},
): AsyncGenerator<string> {
  if (getProvider() === "openrouter") {
    yield* streamChatOpenRouter(messages, options);
    return;
  }
  yield* streamChatGemini(messages, options);
}
