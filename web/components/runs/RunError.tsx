"use client";

import type { RunErrorDto } from "@/lib/observatory-api";
import { ErrorState } from "@/components/state";

export function RunError({ error }: { error: RunErrorDto }) {
  return (
    <ErrorState
      title="运行失败"
      description={`kind: ${error.kind}`}
      detail={error.message}
    />
  );
}
