import { beforeEach, describe, expect, it } from "vitest";
import { useTeamsStore } from "./teamsStore";

describe("teamsStore", () => {
  beforeEach(() => {
    useTeamsStore.getState().clear();
    localStorage.clear();
  });

  it("starts with no active team", () => {
    expect(useTeamsStore.getState().activeTeamId).toBeNull();
  });

  it("sets the active team id", () => {
    useTeamsStore.getState().setActiveTeam("team-1");
    expect(useTeamsStore.getState().activeTeamId).toBe("team-1");
  });

  it("clears the active team", () => {
    useTeamsStore.getState().setActiveTeam("team-1");
    useTeamsStore.getState().clear();
    expect(useTeamsStore.getState().activeTeamId).toBeNull();
  });

  it("accepts null to explicitly clear", () => {
    useTeamsStore.getState().setActiveTeam("team-1");
    useTeamsStore.getState().setActiveTeam(null);
    expect(useTeamsStore.getState().activeTeamId).toBeNull();
  });
});
