import { describe, expect, it } from "vitest";

import { filterCandidates } from "@/lib/rag/retrieve";
import type { MatchedChunk } from "@/types/database";

function candidate(id: string, similarity: number): MatchedChunk {
  return {
    id,
    document_id: "doc-1",
    content: `chunk ${id}`,
    metadata: {},
    similarity,
  };
}

describe("filterCandidates", () => {
  it("keeps only chunks near the best hit", () => {
    const candidates = [
      candidate("a", 0.82),
      candidate("b", 0.79),
      candidate("c", 0.71),
      candidate("d", 0.42),
    ];

    const filtered = filterCandidates(candidates, {
      absoluteFloor: 0.35,
      relativeDelta: 0.12,
      topK: 8,
    });

    expect(filtered.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when the best hit is below the absolute floor", () => {
    const candidates = [candidate("a", 0.2), candidate("b", 0.18)];

    expect(
      filterCandidates(candidates, {
        absoluteFloor: 0.35,
        relativeDelta: 0.12,
      }),
    ).toEqual([]);
  });

  it("keeps a strong result even when siblings are weak", () => {
    // A relevant query retrieves a few strong hits and one weak one. The
    // relative rule should drop the weak outlier, not the strong hits.
    const candidates = [
      candidate("a", 0.63),
      candidate("b", 0.62),
      candidate("c", 0.3),
    ];

    const filtered = filterCandidates(candidates, {
      absoluteFloor: 0.35,
      relativeDelta: 0.12,
    });

    expect(filtered.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("drops everything when even the best hit is weak", () => {
    // The "nothing relevant exists" case: all hits are equally mediocre.
    // The relative rule alone cannot catch this - every candidate is close
    // to the best. Only the absolute floor can.
    const candidates = [candidate("a", 0.31), candidate("b", 0.3)];

    expect(
      filterCandidates(candidates, {
        absoluteFloor: 0.35,
        relativeDelta: 0.12,
      }),
    ).toEqual([]);
  });

  it("caps the result count at topK", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate(`c${i}`, 0.8 - i * 0.001),
    );

    const filtered = filterCandidates(candidates, {
      absoluteFloor: 0.25,
      relativeDelta: 0.12,
      topK: 5,
    });

    expect(filtered).toHaveLength(5);
  });

  it("returns results sorted by descending similarity", () => {
    const candidates = [
      candidate("low", 0.5),
      candidate("high", 0.9),
      candidate("mid", 0.7),
    ];

    const filtered = filterCandidates(candidates, {
      absoluteFloor: 0.35,
      relativeDelta: 0.5,
    });

    expect(filtered.map((c) => c.similarity)).toEqual([
      0.9, 0.7, 0.5,
    ]);
  });

  it("handles an empty candidate list", () => {
    expect(filterCandidates([])).toEqual([]);
  });
});
