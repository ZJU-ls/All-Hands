import { describe, it, expect, vi, afterEach } from "vitest";

import { ApiError, BackendUnreachableError, getConversation } from "../api";

describe("ApiError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getConversation throws ApiError with status on 404 (B05 · silent fallback)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("", { status: 404, statusText: "Not Found" }),
      ),
    );
    await expect(getConversation("dead-id")).rejects.toMatchObject({
      status: 404,
    });
    await expect(getConversation("dead-id")).rejects.toBeInstanceOf(ApiError);
  });

  it("getConversation maps Next.js proxy 500 (text/plain body) to BackendUnreachableError (E14)", async () => {
    // Reproduces the real user-visible symptom: Next.js dev rewrites
    // /api/* → http://localhost:8000/api/*; when uvicorn is offline the
    // dev server answers `500 text/plain "Internal Server Error"` instead
    // of the FastAPI JSON error envelope.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Internal Server Error", {
            status: 500,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );
    await expect(getConversation("x")).rejects.toBeInstanceOf(BackendUnreachableError);
    await expect(getConversation("x")).rejects.toMatchObject({ status: 500 });
  });

  it("getConversation treats 502/503/504 as BackendUnreachable regardless of body", async () => {
    for (const status of [502, 503, 504]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
      await expect(getConversation("x")).rejects.toBeInstanceOf(BackendUnreachableError);
    }
  });

  it("getConversation keeps plain ApiError for real JSON 500 (application error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "db connection lost" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const err = await getConversation("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(BackendUnreachableError);
    expect(err.status).toBe(500);
  });

  it("getConversation resolves with DTO on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "c1",
              employee_id: "e1",
              title: null,
              created_at: "2026-04-19T00:00:00Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const c = await getConversation("c1");
    expect(c.id).toBe("c1");
  });
});
