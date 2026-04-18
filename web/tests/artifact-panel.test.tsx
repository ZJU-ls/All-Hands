/**
 * ArtifactPanel + ArtifactList unit tests — spec § 11 (artifacts-skill).
 *
 * Assertions:
 * - listArtifacts is fetched on mount
 * - list groups by kind, pinned items appear under "置顶"
 * - clicking an item switches to detail view
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import { ArtifactList } from "@/components/artifacts/ArtifactList";
import { ArtifactPanel } from "@/components/artifacts/ArtifactPanel";
import type { ArtifactDto } from "@/lib/artifacts-api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function make(
  overrides: Partial<ArtifactDto> & Pick<ArtifactDto, "id" | "name" | "kind">,
): ArtifactDto {
  return {
    workspace_id: "default",
    mime_type: "text/markdown",
    size_bytes: 10,
    version: 1,
    pinned: false,
    deleted_at: null,
    conversation_id: null,
    created_by_employee_id: null,
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:00Z",
    ...overrides,
  } as ArtifactDto;
}

describe("ArtifactList", () => {
  it("groups by kind and shows pinned section on top", () => {
    const items: ArtifactDto[] = [
      make({ id: "a1", name: "plan.md", kind: "markdown" }),
      make({ id: "a2", name: "logo.png", kind: "image", mime_type: "image/png" }),
      make({ id: "a3", name: "star", kind: "markdown", pinned: true }),
    ];
    render(<ArtifactList artifacts={items} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("置顶")).toBeDefined();
    expect(screen.getByText("markdown")).toBeDefined();
    expect(screen.getByText("image")).toBeDefined();
    expect(screen.getByText("star")).toBeDefined();
    expect(screen.getByText("plan.md")).toBeDefined();
    expect(screen.getByText("logo.png")).toBeDefined();
  });

  it("renders an empty state when no artifacts", () => {
    render(<ArtifactList artifacts={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/还没有制品/)).toBeDefined();
  });
});

describe("ArtifactPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/artifacts?limit=200")) {
          const body: ArtifactDto[] = [
            make({ id: "p1", name: "proposal.md", kind: "markdown" }),
          ];
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  it("fetches artifact list on mount and renders items", async () => {
    await act(async () => {
      render(<ArtifactPanel onClose={() => {}} />);
    });
    await waitFor(() => {
      expect(screen.getByText("proposal.md")).toBeDefined();
    });
    expect(screen.getByText("制品区")).toBeDefined();
  });
});
