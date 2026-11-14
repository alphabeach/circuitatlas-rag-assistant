import { beforeEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMIT_MESSAGE, readableError } from "@/lib/gemini/client";

/** The payload Gemini actually sent for a retired model. */
const RETIRED_MODEL_BODY = JSON.stringify({
  error: {
    code: 404,
    message:
      "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.",
    status: "NOT_FOUND",
  },
});

describe("readableError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("turns a quota refusal into one sentence", () => {
    expect(readableError(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')).toBe(
      RATE_LIMIT_MESSAGE,
    );
  });

  it("turns a retired model into one sentence", () => {
    expect(readableError(404, RETIRED_MODEL_BODY)).toBe(
      "That Gemini model is not available to this account - check the model id.",
    );
  });

  it("never passes the JSON payload through", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const message = readableError(status, RETIRED_MODEL_BODY);
      expect(message).not.toContain("{");
      expect(message).not.toContain("models/gemini");
    }
  });
});
