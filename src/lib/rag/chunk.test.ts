import { describe, expect, it } from "vitest";

import { chunkMarkdown, chunkText, splitMarkdownSections } from "@/lib/rag/chunk";

describe("splitMarkdownSections", () => {
  it("splits on headings and keeps the heading with its body", () => {
    const markdown = [
      "# Buffer Prep",
      "",
      "Prepare the buffer.",
      "",
      "## Storage",
      "",
      "Store at 4C.",
    ].join("\n");

    const sections = splitMarkdownSections(markdown);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("Buffer Prep");
    expect(sections[0].body).toContain("Prepare the buffer.");
    expect(sections[1].heading).toBe("Storage");
    expect(sections[1].body).toContain("Store at 4C.");
  });

  it("treats content before the first heading as a preamble", () => {
    const sections = splitMarkdownSections(
      "Intro text.\n\n# Title\n\nBody.",
    );

    expect(sections[0].heading).toBeNull();
    expect(sections[0].body).toContain("Intro text.");
    expect(sections[1].heading).toBe("Title");
  });
});

describe("chunkMarkdown", () => {
  it("keeps the heading inside the chunk content", () => {
    const chunks = chunkMarkdown("# Lysis\n\nAdd buffer B and incubate.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("# Lysis");
    expect(chunks[0].content).toContain("Add buffer B");
    expect(chunks[0].metadata.heading).toBe("Lysis");
  });

  it("assigns sequential ordinals", () => {
    const chunks = chunkMarkdown(
      "# One\n\nAlpha.\n\n# Two\n\nBeta.\n\n# Three\n\nGamma.",
    );

    expect(chunks.map((c) => c.metadata.ordinal)).toEqual([0, 1, 2]);
  });

  it("splits an oversized section into multiple chunks", () => {
    const long = "word ".repeat(4000);
    const chunks = chunkMarkdown(`# Long\n\n${long}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });

  it("returns nothing for empty input", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });
});

describe("chunkText", () => {
  it("splits plain text into chunks with ordinals", () => {
    const chunks = chunkText("First para.\n\nSecond para.");

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.heading).toBeNull();
    expect(chunks[0].metadata.ordinal).toBe(0);
  });
});
