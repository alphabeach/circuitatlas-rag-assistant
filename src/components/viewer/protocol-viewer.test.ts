import { describe, expect, it } from "vitest";

import {
  bestPassage,
  passagePattern,
} from "@/components/viewer/protocol-viewer";

describe("passagePattern", () => {
  it("matches a passage whose line breaks moved", () => {
    const stored = "Wash the cells.\nPellet at 300 x g.";
    const retrieved = "Wash the cells. Pellet at 300 x g.";

    expect(passagePattern(retrieved).test(stored)).toBe(true);
  });

  it("treats the passage as literal text", () => {
    const pattern = passagePattern("0.5 +/- 0.05 mM (5%)");

    expect(pattern.test("Keep at 0.5 +/- 0.05 mM (5%) exactly")).toBe(true);
    expect(pattern.test("Keep at 0x5 +/- 0x05 mM (5%) exactly")).toBe(false);
  });

  it("does not match a different passage", () => {
    const pattern = passagePattern("Pellet at 300 x g");

    expect(pattern.test("Incubate on ice for 15 minutes")).toBe(false);
  });
});

describe("bestPassage", () => {
  const chunk = [
    "3) LOAD THE SPECIMEN",
    "Before you put anything in the oven make sure it is safe to heat this part.",
    "Always use protective equipment such as gloves and aprons.",
  ].join("\n");

  it("picks the line that answers the question", () => {
    expect(
      bestPassage(chunk, "What protective equipment do I need for the oven?"),
    ).toContain("protective equipment");
  });

  it("falls back to the first line when nothing matches", () => {
    expect(bestPassage(chunk, "zzz")).toBe("3) LOAD THE SPECIMEN");
  });
});
