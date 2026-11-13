import "server-only";

import type { ChatMessage } from "@/lib/openrouter/chat";
import type { Citation } from "@/types/database";

/**
 * Prompt construction.
 *
 * The system prompt is where scientific verifiability is actually enforced.
 * Two mechanisms matter:
 *
 *  1. The model is told to answer only from the provided context and to
 *     cite the source id after every claim.
 *  2. The model is given an explicit escape hatch (`INSUFFICIENT_CONTEXT`).
 *     Without it, a model handed weak context tends to hedge-hallucinate
 *     rather than refuse. With it, the UI can show a clean "not found in
 *     the ingested SOPs" state instead of a plausible-sounding guess.
 */

export const INSUFFICIENT_CONTEXT_MARKER = "INSUFFICIENT_CONTEXT";

export const SYSTEM_PROMPT = `You are CircuitAtlas, an assistant for laboratory technicians and engineering leads working with standard operating procedures (SOPs).

GROUNDING RULES - these are absolute:

1. Answer ONLY from the CONTEXT provided. Do not use prior knowledge, general lab experience, or assumptions about how protocols "usually" work.
2. Cite every factual claim with the source id in square brackets, e.g. [S1]. If a statement comes from multiple sources, cite all of them, e.g. [S1][S3].
3. If the context does not contain the answer, reply with exactly:
   INSUFFICIENT_CONTEXT: <one short sentence explaining what is missing>
   Do not guess. Do not partially answer. Do not pad with generic lab safety advice.
4. If the context contains the answer but is ambiguous or contradictory, say so explicitly and cite the conflicting sources.
5. Do not invent parameter values, reagent names, concentrations, temperatures, durations, or equipment. If a value is not in the context, it does not exist as far as you are concerned.
6. Preserve exact units, tolerances, and numeric values verbatim. If the source says "0.5 +/- 0.05 mM", report "0.5 +/- 0.05 mM", not "approximately 0.5 mM".
7. If the question involves safety-critical procedure, always include the relevant safety and handling constraints found in the context. If none are present, say so.

STYLE:

- Lead with the direct answer. No preamble.
- Use Markdown: short paragraphs, and numbered lists for procedures where the source is ordered.
- Be concise. This is a reference tool, not a chat partner.
- Never repeat the question back.`;

export function buildUserPrompt(question: string, citations: Citation[]): string {
  if (citations.length === 0) {
    return `CONTEXT: (empty - no matching protocol sections were retrieved)

QUESTION: ${question}`;
  }

  const contextBlocks = citations
    .map(
      (citation) =>
        `[S${citation.ordinal}] (source: ${citation.documentTitle}${
          citation.heading ? ` / ${citation.heading}` : ""
        } | confidence: ${(citation.similarity * 100).toFixed(1)}%)\n${citation.content}`,
    )
    .join("\n\n---\n\n");

  return `CONTEXT:
${contextBlocks}

---

QUESTION: ${question}

Answer using only the CONTEXT above, citing sources as [S1], [S2], etc.`;
}

export function buildMessages(
  question: string,
  citations: Citation[],
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(question, citations) },
  ];
}

/** True when the model signalled that the retrieved context was insufficient. */
export function isInsufficientContext(answer: string): boolean {
  return answer.trimStart().startsWith(INSUFFICIENT_CONTEXT_MARKER);
}
