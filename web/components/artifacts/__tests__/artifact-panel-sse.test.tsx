/**
 * I-0005 · frontend half · ArtifactPanel consumes /api/artifacts/stream
 *
 * The test stubs EventSource + artifacts-api, then drives the four event
 * types the backend fan-outs (`artifact_changed` frames with
 * op = created / updated / deleted / pinned) and asserts each mutates the
 * panel's list in-place without a page reload / polling round-trip.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ArtifactDto } from "@/lib/artifacts-api";

// --- module mocks ---------------------------------------------------------

vi.mock("@/components/artifacts/ArtifactDetail", () => ({
  ArtifactDetail: ({ artifactId }: { artifactId: string }) => (
    <div data-testid="detail">detail:{artifactId}</div>
  ),
}));

const { listMock, getMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
}));
vi.mock("@/lib/artifacts-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/artifacts-api")>("@/lib/artifacts-api");
  return {
    ...actual,
    listArtifacts: listMock,
    getArtifact: getMock,
    artifactStreamUrl: () => "/api/artifacts/stream",
  };
});

// --- EventSource stub -----------------------------------------------------

type Handler = (evt: MessageEvent | Event) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, Handler[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: Handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: Handler) {
    const arr = this.listeners[type];
    if (!arr) return;
    this.listeners[type] = arr.filter((h) => h !== handler);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload?: unknown) {
    const evt = new MessageEvent(type, { data: JSON.stringify(payload ?? {}) });
    (this.listeners[type] ?? []).forEach((h) => h(evt));
  }
  emitError() {
    (this.listeners.error ?? []).forEach((h) => h(new Event("error")));
  }
}

// --- fixture helpers ------------------------------------------------------

function makeArtifact(over: Partial<ArtifactDto> = {}): ArtifactDto {
  return {
    id: over.id ?? "art_1",
    workspace_id: "default",
    name: over.name ?? "notes.md",
    kind: over.kind ?? "markdown",
    mime_type: "text/markdown",
    size_bytes: 42,
    version: over.version ?? 1,
    pinned: over.pinned ?? false,
    deleted_at: null,
    conversation_id: null,
    created_by_employee_id: null,
    created_at: "2026-04-19T10:00:00Z",
    updated_at: over.updated_at ?? "2026-04-19T10:00:00Z",
    ...over,
  };
}

function changedFrame(
  op: "created" | "updated" | "deleted" | "pinned",
  artifactId: string,
  extras: Partial<{ version: number; artifact_kind: string }> = {},
) {
  return {
    id: `evt_${op}_${artifactId}`,
    kind: "artifact_changed" as const,
    ts: "2026-04-19T10:01:00Z",
    payload: {
      workspace_id: "default",
      artifact_id: artifactId,
      artifact_kind: extras.artifact_kind ?? "markdown",
      op,
      version: extras.version ?? 1,
      conversation_id: null,
    },
  };
}

// --- test setup -----------------------------------------------------------

const originalES = globalThis.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  listMock.mockReset();
  getMock.mockReset();
  // @ts-expect-error — jsdom ships no EventSource
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  cleanup();
  if (originalES) {
    globalThis.EventSource = originalES;
  } else {
    // @ts-expect-error — drop the stub
    delete globalThis.EventSource;
  }
});

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ArtifactPanel · SSE consumer (I-0005)", () => {
  it("opens /api/artifacts/stream and shows LoadingState → list after fetch", async () => {
    let resolveList: (xs: ArtifactDto[]) => void = () => undefined;
    listMock.mockImplementation(
      () =>
        new Promise<ArtifactDto[]>((res) => {
          resolveList = res;
        }),
    );
    const { ArtifactPanel } = await import("../ArtifactPanel");
    render(<ArtifactPanel onClose={() => {}} />);

    expect(screen.getByRole("status")).toBeDefined(); // LoadingState
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/artifacts/stream");

    await act(async () => {
      resolveList([makeArtifact({ id: "art_seed", name: "seed.md" })]);
    });
    await flushPromises();

    expect(screen.getByText("seed.md")).toBeDefined();
  });

  it("prepends on created · refetches via getArtifact", async () => {
    listMock.mockResolvedValue([]);
    getMock.mockResolvedValue(makeArtifact({ id: "art_new", name: "fresh.md" }));
    const { ArtifactPanel } = await import("../ArtifactPanel");
    render(<ArtifactPanel onClose={() => {}} />);
    await flushPromises();

    await act(async () => {
      FakeEventSource.instances[0]!.emit("CUSTOM", {
        name: "allhands.artifact_changed",
        value: changedFrame("created", "art_new"),
      });
    });
    await flushPromises();
    await flushPromises();

    expect(getMock).toHaveBeenCalledWith("art_new");
    expect(screen.getByText("fresh.md")).toBeDefined();
  });

  it("updates in-place on updated · same id replaces the row", async () => {
    listMock.mockResolvedValue([makeArtifact({ id: "art_1", name: "v1.md", version: 1 })]);
    getMock.mockResolvedValue(
      makeArtifact({ id: "art_1", name: "v2.md", version: 2 }),
    );
    const { ArtifactPanel } = await import("../ArtifactPanel");
    render(<ArtifactPanel onClose={() => {}} />);
    await flushPromises();

    expect(screen.getByText("v1.md")).toBeDefined();

    await act(async () => {
      FakeEventSource.instances[0]!.emit("CUSTOM", {
        name: "allhands.artifact_changed",
        value: changedFrame("updated", "art_1", { version: 2 }),
      });
    });
    await flushPromises();
    await flushPromises();

    expect(screen.queryByText("v1.md")).toBeNull();
    expect(screen.getByText("v2.md")).toBeDefined();
  });

  it("removes row on deleted · no getArtifact call needed", async () => {
    listMock.mockResolvedValue([
      makeArtifact({ id: "art_1", name: "keep.md" }),
      makeArtifact({ id: "art_2", name: "bye.md" }),
    ]);
    const { ArtifactPanel } = await import("../ArtifactPanel");
    render(<ArtifactPanel onClose={() => {}} />);
    await flushPromises();

    expect(screen.getByText("bye.md")).toBeDefined();

    await act(async () => {
      FakeEventSource.instances[0]!.emit("CUSTOM", {
        name: "allhands.artifact_changed",
        value: changedFrame("deleted", "art_2"),
      });
    });
    await flushPromises();

    expect(screen.queryByText("bye.md")).toBeNull();
    expect(screen.getByText("keep.md")).toBeDefined();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("flips pinned via stream · no local setState from the pin action", async () => {
    listMock.mockResolvedValue([
      makeArtifact({ id: "art_1", name: "report.md", pinned: false }),
    ]);
    getMock.mockResolvedValue(
      makeArtifact({ id: "art_1", name: "report.md", pinned: true }),
    );
    const { ArtifactPanel } = await import("../ArtifactPanel");
    render(<ArtifactPanel onClose={() => {}} />);
    await flushPromises();

    // No "置顶" section header before the pin event arrives.
    expect(screen.queryByText("置顶")).toBeNull();

    await act(async () => {
      FakeEventSource.instances[0]!.emit("CUSTOM", {
        name: "allhands.artifact_changed",
        value: changedFrame("pinned", "art_1"),
      });
    });
    await flushPromises();
    await flushPromises();

    expect(getMock).toHaveBeenCalledWith("art_1");
    // Pinned rows get their own "置顶" section via ArtifactList.
    expect(screen.getByText("置顶")).toBeDefined();
  });

  it("never installs a polling interval", async () => {
    listMock.mockResolvedValue([]);
    const spy = vi.spyOn(globalThis, "setInterval");
    const { ArtifactPanel } = await import("../ArtifactPanel");
    render(<ArtifactPanel onClose={() => {}} />);
    await flushPromises();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("closes the EventSource on unmount", async () => {
    listMock.mockResolvedValue([]);
    const { ArtifactPanel } = await import("../ArtifactPanel");
    const { unmount } = render(<ArtifactPanel onClose={() => {}} />);
    await flushPromises();

    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });
});
