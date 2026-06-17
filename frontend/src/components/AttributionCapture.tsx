"use client";

import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution";

// Phase 12w — captures first-touch attribution on initial mount, before the
// visitor reaches signup. Renders nothing. Mounted once in the root layout so
// it runs on whatever page the visitor lands on (a marketing link to "/" then
// a click through to /signup still credits the original source). First-touch
// is locked on the first call, so re-mounts are no-ops.
export function AttributionCapture(): null {
  useEffect(() => {
    captureAttribution();
  }, []);
  return null;
}
