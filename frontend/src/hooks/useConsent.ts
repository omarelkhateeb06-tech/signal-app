"use client";

import { useEffect, useState } from "react";
import {
  CONSENT_EVENT,
  getConsent,
  setConsent,
  type ConsentChoice,
} from "@/lib/consent";

export interface UseConsent {
  choice: ConsentChoice | null;
  /** True until the reader has made a choice — drives whether the banner shows. */
  decided: boolean;
  accept: () => void;
  reject: () => void;
}

export function useConsent(): UseConsent {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setChoice(getConsent());
    const onChange = (): void => setChoice(getConsent());
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);

  return {
    choice,
    // Pre-mount (SSR / first paint) treat as decided so the banner never
    // flashes before hydration; after mount it shows only when no choice exists.
    decided: !mounted || choice !== null,
    accept: () => setConsent("accepted"),
    reject: () => setConsent("rejected"),
  };
}
