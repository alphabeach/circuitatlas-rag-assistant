import { runRagPipeline } from "@/lib/rag/pipeline";
import { MAX_QUERY_LENGTH } from "@/lib/constants";

/**
 * POST /api/chat
 *
 * Streams a RAG answer as Server-Sent Events.
 *
 * Event frames:
 *   event: citations  - the retrieved chunks with their similarity scores
 *   event: delta      - a text delta from the model
 *   event: done       - final answer, citations, and the insufficient flag
 *   event: error      - a failure message
 *
 * Citations are emitted *before* the first delta so the source drawer can
 * populate while the answer is still streaming.
 */

export const maxDuration = 60;

type ChatRequest = {
  query?: unknown;
  documentId?: unknown;
};

export async function POST(request: Request) {
  let payload: ChatRequest;

  try {
    payload = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  const documentId =
    typeof payload.documentId === "string" && payload.documentId
      ? payload.documentId
      : undefined;

  if (!query) {
    return Response.json({ error: "Query is required" }, { status: 400 });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `Query is too long (max ${MAX_QUERY_LENGTH} characters)` },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        for await (const event of runRagPipeline(query, {
          documentId,
          signal: abortController.signal,
        })) {
          if (event.type === "citations") {
            send("citations", { citations: event.citations });
          } else if (event.type === "delta") {
            send("delta", { text: event.text });
          } else if (event.type === "done") {
            send("done", {
              answer: event.answer,
              citations: event.citations,
              insufficient: event.insufficient,
            });
          } else {
            send("error", { message: event.message });
          }
        }
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
