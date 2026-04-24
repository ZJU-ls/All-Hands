"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cockpit } from "@/components/cockpit/Cockpit";

const VISITED_KEY = "allhands:visited";

export default function HomePage() {
  const router = useRouter();
  const [cleared, setCleared] = useState(false);

  // First-visit redirect to /welcome. Once the visitor enters the app
  // (either via the welcome CTA or by manually hitting `/` after the
  // flag exists), subsequent loads land on Cockpit directly.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(VISITED_KEY)) {
        router.replace("/welcome");
        return;
      }
    } catch {
      /* storage unavailable — fall through to Cockpit. */
    }
    setCleared(true);
  }, [router]);

  if (!cleared) return null;
  return <Cockpit />;
}
