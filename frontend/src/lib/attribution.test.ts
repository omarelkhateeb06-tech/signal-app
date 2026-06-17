import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAttribution, getAttribution } from "./attribution";

// jsdom gives us localStorage + a mutable location/referrer via vi.stubGlobal.
describe("attribution", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function setLocation(href: string): void {
    const url = new URL(href);
    vi.stubGlobal("location", {
      search: url.search,
      pathname: url.pathname,
      host: url.host,
    } as unknown as Location);
  }

  function setReferrer(ref: string): void {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: ref,
    });
  }

  it("captures utm params and landing path", () => {
    setLocation("https://signal.so/?utm_source=reddit&utm_medium=organic&utm_campaign=r_ai");
    setReferrer("");
    captureAttribution();

    expect(getAttribution()).toEqual({
      utm_source: "reddit",
      utm_medium: "organic",
      utm_campaign: "r_ai",
      landing_path: "/",
    });
  });

  it("captures an external referrer but ignores a same-origin one", () => {
    setLocation("https://signal.so/feed");
    setReferrer("https://news.ycombinator.com/");
    captureAttribution();
    expect(getAttribution()?.referrer).toBe("https://news.ycombinator.com/");

    // Reset and prove same-origin referrers are dropped.
    localStorage.clear();
    setLocation("https://signal.so/feed");
    setReferrer("https://signal.so/");
    captureAttribution();
    expect(getAttribution()?.referrer).toBeUndefined();
  });

  it("is first-touch — a later capture never overwrites the first", () => {
    setLocation("https://signal.so/?utm_source=reddit");
    setReferrer("");
    captureAttribution();

    // Second visit with a different source must not clobber the first.
    setLocation("https://signal.so/?utm_source=twitter");
    captureAttribution();

    expect(getAttribution()?.utm_source).toBe("reddit");
  });

  it("returns null when nothing was captured", () => {
    expect(getAttribution()).toBeNull();
  });
});
