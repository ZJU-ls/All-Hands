import { describe, it, expect, vi, afterEach } from "vitest";

import { ApiError, getConversation } from "../api";

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

  it("getConversation throws ApiError with 500 on server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(getConversation("x")).rejects.toMatchObject({ status: 500 });
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
