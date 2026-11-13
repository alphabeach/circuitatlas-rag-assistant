import "server-only";

import { embedQuery } from "@/lib/openrouter/embeddings";
import { streamChat } from "@/lib/openrouter/chat";
import { buildMessages } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";
import type { Citation } from "@/types/database";

/**
 * The RAG pipeline.
 *
 * embed -> retrieve -> filter -> assemble -> generate
 *
 * Kept as a single function so the API route stays thin and the whole
 * flow can be exercised from a test or the CLI without HTTP.
 */

export type PipelineEvent =
  | { type: "citations"; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "done"; answer: string; citations: Citation[]; insufficient: boolean }
  | { type: "error"; message: string };

export async function* runRagPipeline(
  question: string,
  options: { documentId?: string; signal?: AbortSignal } = {},
): AsyncGenerator<PipelineEvent> {
  try {
    // 1. Vectorize the query.
    const queryEmbedding = await embedQuery(question);

    // 2. Over-fetch, then apply the relative relevance filter.
    const { citations } = await retrieveChunks(queryEmbedding, {
      documentId: options.documentId,
    });

    // 3. Emit citations before the answer so the drawer can populate while
    //    the answer is still streaming.
    yield { type: "citations", citations };

    // 4. No relevant context -> abstain without calling the model.
    if (citations.length === 0) {
      yield {
        type: "done",
        answer:
          "INSUFFICIENT_CONTEXT: No matching protocol sections were found in the ingested SOPs.",
        citations,
        insufficient: true,
      };
      return;
    }

    // 5. Assemble the prompt and stream the answer.
    const messages = buildMessages(question, citations);

    let answer = "";
    for await (const delta of streamChat(messages, { signal: options.signal })) {
      answer += delta;
      yield { type: "delta", text: delta };
    }

    yield {
      type: "done",
      answer,
      citations,
      insufficient: answer.trimStart().startsWith("INSUFFICIENT_CONTEXT"),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected pipeline error";
    yield { type: "error", message };
  }
}
