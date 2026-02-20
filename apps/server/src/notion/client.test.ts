import { describe, expect, test } from "bun:test";
import {
  createNotionClient,
  isRetryableNotionStatus,
  normalizeNotionId,
} from "./client";

describe("isRetryableNotionStatus", () => {
  test("classifies retryable status codes", () => {
    expect(isRetryableNotionStatus(429)).toBeTrue();
    expect(isRetryableNotionStatus(500)).toBeTrue();
    expect(isRetryableNotionStatus(503)).toBeTrue();
    expect(isRetryableNotionStatus(400)).toBeFalse();
    expect(isRetryableNotionStatus(401)).toBeFalse();
  });
});

describe("normalizeNotionId", () => {
  test("extracts id from url and compact ids", () => {
    expect(normalizeNotionId("9f6bd4d9af6c4d2e8e7495ca11d385fa")).toBe(
      "9f6bd4d9-af6c-4d2e-8e74-95ca11d385fa"
    );
    expect(
      normalizeNotionId(
        "https://www.notion.so/My-Page-9f6bd4d9af6c4d2e8e7495ca11d385fa"
      )
    ).toBe("9f6bd4d9-af6c-4d2e-8e74-95ca11d385fa");
  });
});

describe("appendBlockChildren", () => {
  test("chunks writes into API-safe requests", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];

    const mockFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const reqBody =
        init?.body && typeof init.body === "string"
          ? (JSON.parse(init.body) as { children?: unknown[] })
          : { children: [] };
      const results = (reqBody.children ?? []).map((_, idx) => ({
        id: `blk_${calls.length}_${idx}`,
      }));
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createNotionClient({
      getToken: async () => "secret_test_token",
      getApiVersion: () => "2025-09-03",
      fetchFn: mockFetch,
      minDelayMs: 0,
      maxRetries: 0,
    });

    const children = Array.from({ length: 121 }, (_, i) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: {
        rich_text: [{ type: "text" as const, text: { content: `row ${i}` } }],
      },
    }));

    const ids = await client.appendBlockChildren({
      blockId: "9f6bd4d9af6c4d2e8e7495ca11d385fa",
      children,
      chunkSize: 50,
    });

    expect(calls.length).toBe(3);
    expect(calls[0]?.url).toContain(
      "/blocks/9f6bd4d9-af6c-4d2e-8e74-95ca11d385fa/children"
    );

    const sentSizes = calls.map((c) =>
      Array.isArray((c.body as { children?: unknown[] })?.children)
        ? ((c.body as { children?: unknown[] }).children?.length ?? 0)
        : 0
    );
    expect(sentSizes).toEqual([50, 50, 21]);
    expect(ids).toHaveLength(121);
  });
});
