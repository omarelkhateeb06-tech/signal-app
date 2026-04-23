import { beforeEach, describe, expect, it } from "vitest";
import { useOnboardingStore } from "./onboardingStore";

describe("useOnboardingStore", () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  it("starts with empty multi-selects and a sensible default depth preference", () => {
    const s = useOnboardingStore.getState();
    expect(s.sectors).toEqual([]);
    expect(s.topics).toEqual([]);
    expect(s.goals).toEqual([]);
    expect(s.depthPreference).toBe("standard");
    expect(s.role).toBeNull();
    expect(s.digestPreference).toBeNull();
  });

  it("updates individual fields independently", () => {
    const { setSectors, setRole, setDepthPreference } = useOnboardingStore.getState();
    setSectors(["ai", "finance"]);
    setRole("engineer");
    setDepthPreference("technical");
    const s = useOnboardingStore.getState();
    expect(s.sectors).toEqual(["ai", "finance"]);
    expect(s.role).toBe("engineer");
    expect(s.depthPreference).toBe("technical");
  });

  it("reset() clears all fields back to initial state", () => {
    const store = useOnboardingStore.getState();
    store.setSectors(["ai"]);
    store.setRole("engineer");
    store.setTopics([{ sector: "ai", topic: "agents" }]);
    store.setGoals(["deep_learning"]);
    store.setTimezone("America/New_York");

    useOnboardingStore.getState().reset();
    const after = useOnboardingStore.getState();
    expect(after.sectors).toEqual([]);
    expect(after.role).toBeNull();
    expect(after.topics).toEqual([]);
    expect(after.goals).toEqual([]);
    expect(after.timezone).toBeNull();
    expect(after.depthPreference).toBe("standard");
  });
});
