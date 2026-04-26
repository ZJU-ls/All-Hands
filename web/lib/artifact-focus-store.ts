/**
 * artifact-focus-store · cross-component artifact panel focus.
 *
 * Why a separate store:
 * - The chat page owns `panelOpen` (React useState).
 * - ArtifactPanel owns `selectedId` (React useState).
 * - Click-to-focus from a chat render card needs to flip BOTH from outside.
 *
 * Lifting state up is invasive. A tiny zustand store lets any component fire
 * `focusArtifact(id)` and any listener (chat page · ArtifactPanel) reacts in
 * its own effect. SSR-safe: zustand initializes lazily.
 *
 * Bump tick is intentional — same id can be focused twice (e.g. user clicks
 * the same card after closing) and the listener should re-trigger scroll.
 */

import { create } from "zustand";

type ArtifactFocusState = {
  artifactId: string | null;
  bumpTick: number;
  focus: (artifactId: string) => void;
  clear: () => void;
};

export const useArtifactFocus = create<ArtifactFocusState>((set, get) => ({
  artifactId: null,
  bumpTick: 0,
  focus: (artifactId) =>
    set({ artifactId, bumpTick: get().bumpTick + 1 }),
  clear: () => set({ artifactId: null }),
}));
