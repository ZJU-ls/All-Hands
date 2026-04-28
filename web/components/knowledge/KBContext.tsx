"use client";

/**
 * KBContext — shared by the L2 layout and any tab page that wants to read /
 * refresh the active KB row + health snapshot without doing its own fetch.
 *
 * The layout fetches once + provides; tab pages call `useKBContext()`.
 */

import { createContext, useContext } from "react";
import type { KBDto, KBHealthDto } from "@/lib/kb-api";

export interface KBContextShape {
  kb: KBDto;
  health: KBHealthDto | null;
  refresh: () => Promise<void>;
  setHealth: (h: KBHealthDto | null) => void;
}

export const KBContext = createContext<KBContextShape | null>(null);

export function useKBContext(): KBContextShape {
  const ctx = useContext(KBContext);
  if (!ctx) {
    throw new Error(
      "useKBContext must be used inside /knowledge/[kbId]/layout.tsx",
    );
  }
  return ctx;
}
