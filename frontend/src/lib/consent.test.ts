import { beforeEach, describe, it, expect } from "vitest";
import {
  getConsent,
  setConsent,
  hasAnalyticsConsent,
} from "./consent";

describe("consent", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null before any choice", () => {
    expect(getConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("persists and reads an accept", () => {
    setConsent("accepted");
    expect(getConsent()).toBe("accepted");
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it("persists a reject and gates analytics off", () => {
    setConsent("rejected");
    expect(getConsent()).toBe("rejected");
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem("signal_consent_v1", "garbage");
    expect(getConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });
});
