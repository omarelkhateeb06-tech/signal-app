import request from "supertest";
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

import { createApp } from "../src/app";
import { generateToken, hashPassword } from "../src/services/authService";
import { signInviteToken } from "../src/services/teamInviteService";

const app = createApp();

const adminId = "11111111-1111-1111-1111-111111111111";
const memberId = "22222222-2222-2222-2222-222222222222";
const outsiderId = "33333333-3333-3333-3333-333333333333";
const teamId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const inviteId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const adminEmail = "admin@example.com";
const memberEmail = "member@example.com";
const outsiderEmail = "outsider@example.com";
const inviteeEmail = "newbie@example.com";

function teamRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: teamId,
    name: "Acme",
    slug: "acme",
    description: "Makers of things",
    createdBy: adminId,
    createdAt: new Date("2026-04-10T00:00:00Z"),
    updatedAt: new Date("2026-04-10T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe("teams endpoints", () => {
  let adminToken: string;
  let memberToken: string;
  let outsiderToken: string;

  beforeEach(() => {
    mock.reset();
    adminToken = generateToken(adminId, adminEmail);
    memberToken = generateToken(memberId, memberEmail);
    outsiderToken = generateToken(outsiderId, outsiderEmail);
  });

  // ---------- Auth gating ----------

  describe("auth gating", () => {
    it("rejects POST /teams without token", async () => {
      const res = await request(app).post("/api/v1/teams").send({ name: "x", slug: "x-team" });
      expect(res.status).toBe(401);
    });

    it("rejects GET /teams without token", async () => {
      const res = await request(app).get("/api/v1/teams");
      expect(res.status).toBe(401);
    });

    it("rejects GET /teams/:id without token", async () => {
      const res = await request(app).get(`/api/v1/teams/${teamId}`);
      expect(res.status).toBe(401);
    });

    it("rejects malformed Authorization header", async () => {
      const res = await request(app).get("/api/v1/teams").set("Authorization", "garbage");
      expect(res.status).toBe(401);
    });
  });

  // ---------- createTeam ----------

  describe("POST /api/v1/teams", () => {
    it("validates slug format", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .set(...auth(adminToken))
        .send({ name: "Acme", slug: "Has Spaces" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("validates required name", async () => {
      const res = await request(app)
        .post("/api/v1/teams")
        .set(...auth(adminToken))
        .send({ slug: "acme" });
      expect(res.status).toBe(400);
    });

    it("returns 409 when slug is taken", async () => {
      mock.queueSelect([{ id: "other-team" }]);
      const res = await request(app)
        .post("/api/v1/teams")
        .set(...auth(adminToken))
        .send({ name: "Acme", slug: "acme" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SLUG_TAKEN");
    });

    it("creates team, makes caller admin, returns shaped payload", async () => {
      mock.queueSelect([]); // slug check: free
      mock.queueInsert([{ id: teamId, name: "Acme", slug: "acme" }]); // insert team
      mock.queueInsert([]); // insert member (no returning)
      mock.queueSelect([teamRow()]); // loadTeam

      const res = await request(app)
        .post("/api/v1/teams")
        .set(...auth(adminToken))
        .send({ name: "Acme", slug: "acme", description: "Makers of things" });

      expect(res.status).toBe(201);
      expect(res.body.data.team.id).toBe(teamId);
      expect(res.body.data.team.slug).toBe("acme");
      expect(res.body.data.team.role).toBe("admin");
    });
  });

  // ---------- listTeams ----------

  describe("GET /api/v1/teams", () => {
    it("returns caller's teams", async () => {
      mock.queueSelect([
        {
          id: teamId,
          name: "Acme",
          slug: "acme",
          description: null,
          createdBy: adminId,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          role: "admin",
        },
      ]);
      const res = await request(app).get("/api/v1/teams").set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.teams).toHaveLength(1);
      expect(res.body.data.teams[0].role).toBe("admin");
    });

    it("returns empty list when caller has no teams", async () => {
      mock.queueSelect([]);
      const res = await request(app).get("/api/v1/teams").set(...auth(outsiderToken));
      expect(res.status).toBe(200);
      expect(res.body.data.teams).toEqual([]);
    });
  });

  // ---------- getTeam ----------

  describe("GET /api/v1/teams/:team_id", () => {
    it("returns 404 when team does not exist", async () => {
      mock.queueSelect([]); // loadTeam miss
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}`)
        .set(...auth(memberToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TEAM_NOT_FOUND");
    });

    it("returns 404 when team is soft-deleted", async () => {
      mock.queueSelect([teamRow({ deletedAt: new Date() })]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}`)
        .set(...auth(memberToken));
      expect(res.status).toBe(404);
    });

    it("returns 403 when caller is not a member", async () => {
      mock.queueSelect([teamRow()]); // loadTeam
      mock.queueSelect([]); // membership miss
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}`)
        .set(...auth(outsiderToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns team with caller role when member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}`)
        .set(...auth(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.data.team.id).toBe(teamId);
      expect(res.body.data.team.role).toBe("member");
    });

    it("validates uuid param", async () => {
      const res = await request(app)
        .get("/api/v1/teams/not-a-uuid")
        .set(...auth(memberToken));
      expect(res.status).toBe(400);
    });
  });

  // ---------- updateTeam ----------

  describe("PATCH /api/v1/teams/:team_id", () => {
    it("returns 403 when non-admin member attempts update", async () => {
      mock.queueSelect([teamRow()]); // loadTeam
      mock.queueSelect([{ id: "m1", role: "member" }]); // membership = member
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}`)
        .set(...auth(memberToken))
        .send({ name: "New Name" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when caller is not a member at all", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([]);
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}`)
        .set(...auth(outsiderToken))
        .send({ name: "New Name" });
      expect(res.status).toBe(403);
    });

    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}`)
        .set(...auth(adminToken))
        .send({});
      expect(res.status).toBe(400);
    });

    it("updates name when admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([teamRow({ name: "Renamed" })]);
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}`)
        .set(...auth(adminToken))
        .send({ name: "Renamed" });
      expect(res.status).toBe(200);
      expect(res.body.data.team.name).toBe("Renamed");
      expect(mock.state.updatedRows[0]).toHaveProperty("name", "Renamed");
    });

    it("returns 409 when updating to a taken slug", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([{ id: "other-team" }]); // slug conflict
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}`)
        .set(...auth(adminToken))
        .send({ slug: "taken" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SLUG_TAKEN");
    });
  });

  // ---------- deleteTeam ----------

  describe("DELETE /api/v1/teams/:team_id", () => {
    it("returns 403 when caller is not admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}`)
        .set(...auth(memberToken));
      expect(res.status).toBe(403);
    });

    it("soft-deletes the team when admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(teamId);
      expect(mock.state.updatedRows[0]).toHaveProperty("deletedAt");
    });

    it("returns 404 when team missing", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(404);
    });
  });

  // ---------- listMembers ----------

  describe("GET /api/v1/teams/:team_id/members", () => {
    it("requires membership", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/members`)
        .set(...auth(outsiderToken));
      expect(res.status).toBe(403);
    });

    it("lists members for a member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      mock.queueSelect([
        {
          id: "m-admin",
          userId: adminId,
          role: "admin",
          joinedAt: new Date(),
          email: adminEmail,
          name: "Admin",
        },
        {
          id: "m-1",
          userId: memberId,
          role: "member",
          joinedAt: new Date(),
          email: memberEmail,
          name: "Member",
        },
      ]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/members`)
        .set(...auth(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.data.members).toHaveLength(2);
    });
  });

  // ---------- removeMember ----------

  describe("DELETE /api/v1/teams/:team_id/members/:user_id", () => {
    it("returns 403 when caller is not admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
        .set(...auth(memberToken));
      expect(res.status).toBe(403);
    });

    it("returns 404 when target is not a member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([]); // target missing
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
    });

    it("removes a regular member when admin requests", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]); // self
      mock.queueSelect([{ id: "m2", role: "member" }]); // target
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(mock.state.deletes).toHaveLength(1);
    });

    it("refuses to remove the last admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]); // self
      mock.queueSelect([{ id: "m2", role: "admin" }]); // target is admin
      mock.queueSelect([{ count: 1 }]); // only 1 admin
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("LAST_ADMIN");
    });

    it("allows removing an admin when multiple admins exist", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([{ id: "m2", role: "admin" }]);
      mock.queueSelect([{ count: 2 }]);
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
    });
  });

  // ---------- invite ----------

  describe("POST /api/v1/teams/:team_id/invites", () => {
    it("returns 403 when caller is not admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(memberToken))
        .send({ email: inviteeEmail, role: "member" });
      expect(res.status).toBe(403);
    });

    it("rejects invalid email", async () => {
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(adminToken))
        .send({ email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("rejects invalid role", async () => {
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(adminToken))
        .send({ email: inviteeEmail, role: "owner" });
      expect(res.status).toBe(400);
    });

    it("returns 409 when invitee is already a member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]); // self
      mock.queueSelect([{ id: memberId }]); // user exists
      mock.queueSelect([{ id: "m-existing", role: "member" }]); // existing membership
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(adminToken))
        .send({ email: memberEmail, role: "member" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_MEMBER");
    });

    it("creates an invite for a new email", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]); // self
      mock.queueSelect([]); // no existing user
      mock.queueInsert([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          token: "x.y",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([{ name: "Admin", email: adminEmail }]); // inviter lookup

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(adminToken))
        .send({ email: inviteeEmail, role: "member" });

      expect(res.status).toBe(201);
      expect(res.body.data.invite.email).toBe(inviteeEmail);
      expect(res.body.data.invite.role).toBe("member");
    });

    it("creates an invite for an existing user who is not yet a member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([{ id: "some-user" }]); // user exists
      mock.queueSelect([]); // not yet a member
      mock.queueInsert([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "viewer",
          token: "x.y",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([{ name: "Admin", email: adminEmail }]);

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(adminToken))
        .send({ email: inviteeEmail, role: "viewer" });
      expect(res.status).toBe(201);
      expect(res.body.data.invite.role).toBe("viewer");
    });
  });

  // ---------- join ----------

  describe("POST /api/v1/teams/join", () => {
    const inviteeToken = () => generateToken(outsiderId, inviteeEmail);

    it("returns 400 when token is missing", async () => {
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(adminToken))
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when token signature is invalid", async () => {
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token: "bogus.token" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INVITE");
    });

    it("returns 400 when token is not in the invites table", async () => {
      const { token } = signInviteToken({ teamId, email: inviteeEmail, role: "member" });
      mock.queueSelect([]); // no invite row
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INVITE");
    });

    it("returns 410 when invite has already been used", async () => {
      const { token } = signInviteToken({ teamId, email: inviteeEmail, role: "member" });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
        },
      ]);
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITE_USED");
    });

    it("returns 410 when invite expiresAt is in the past (even if signature verifies)", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
        ttlMs: 60 * 60 * 1000,
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() - 60_000), // DB says expired
          usedAt: null,
        },
      ]);
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITE_EXPIRED");
    });

    it("returns 403 when caller email does not match invite email", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      const wrongToken = generateToken(outsiderId, "someone-else@example.com");
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(wrongToken))
        .send({ token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVITE_EMAIL_MISMATCH");
    });

    it("joins successfully and marks invite as used", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([teamRow()]); // loadTeam
      mock.queueSelect([]); // no existing membership
      mock.queueInsert([]); // insert member

      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token });

      expect(res.status).toBe(201);
      expect(res.body.data.team_id).toBe(teamId);
      expect(res.body.data.role).toBe("member");
      expect(res.body.data.already_member).toBe(false);
      expect(mock.state.updatedRows).toHaveLength(1);
      expect(mock.state.updatedRows[0]).toHaveProperty("usedAt");
    });

    it("is idempotent for an already-joined user (still marks invite used)", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "existing", role: "member" }]);

      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.data.already_member).toBe(true);
      expect(mock.state.updatedRows).toHaveLength(1);
    });

    it("cannot be replayed after use (second request finds used_at set)", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(), // already consumed
        },
      ]);
      const res = await request(app)
        .post("/api/v1/teams/join")
        .set(...auth(inviteeToken()))
        .send({ token });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITE_USED");
    });
  });

  // ---------- Phase 9b-1: team feed ----------

  const storyId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  describe("GET /api/v1/teams/:team_id/feed", () => {
    it("rejects unauthenticated", async () => {
      const res = await request(app).get(`/api/v1/teams/${teamId}/feed`);
      expect(res.status).toBe(401);
    });

    it("returns 403 when caller is not a member", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: ["ai"] } })]);
      mock.queueSelect([]); // membership miss
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/feed`)
        .set(...auth(outsiderToken));
      expect(res.status).toBe(403);
    });

    it("returns empty list when team has no sectors configured", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: [] } })]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/feed`)
        .set(...auth(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.data.stories).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });

    it("returns stories filtered by team sectors with pagination", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: ["ai", "finance"] } })]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      mock.queueSelect([
        {
          id: storyId,
          sector: "ai",
          headline: "Breakthrough",
          context: "ctx",
          whyItMatters: "why",
          sourceUrl: "https://example.com",
          sourceName: "Example",
          publishedAt: new Date(),
          createdAt: new Date(),
          authorId: null,
          authorName: null,
          saveCount: 3,
          commentCount: 1,
        },
      ]);
      mock.queueSelect([{ count: 1 }]);

      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/feed?limit=5&offset=0`)
        .set(...auth(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(1);
      expect(res.body.data.stories[0].save_count).toBe(3);
      expect(res.body.data.stories[0].team_comment_count).toBe(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.has_more).toBe(false);
    });

    it("validates limit bounds", async () => {
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/feed?limit=999`)
        .set(...auth(memberToken));
      expect(res.status).toBe(400);
    });
  });

  // ---------- Phase 9b-1: team-scoped comments ----------

  describe("GET /api/v1/teams/:team_id/stories/:story_id/comments", () => {
    it("rejects unauthenticated", async () => {
      const res = await request(app).get(
        `/api/v1/teams/${teamId}/stories/${storyId}/comments`,
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 when caller is not a member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(outsiderToken));
      expect(res.status).toBe(403);
    });

    it("returns 404 when story does not exist", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      mock.queueSelect([]); // story missing
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(memberToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("returns team-scoped comments when member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      mock.queueSelect([{ id: storyId }]);
      mock.queueSelect([
        {
          id: "c1",
          storyId,
          teamId,
          userId: memberId,
          parentCommentId: null,
          content: "great read",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          authorName: "Member",
          authorEmail: memberEmail,
        },
      ]);
      mock.queueSelect([{ count: 1 }]);

      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(memberToken));
      expect(res.status).toBe(200);
      expect(res.body.data.comments).toHaveLength(1);
      expect(res.body.data.comments[0].team_id).toBe(teamId);
      expect(res.body.data.comments[0].content).toBe("great read");
    });
  });

  describe("POST /api/v1/teams/:team_id/stories/:story_id/comments", () => {
    it("rejects unauthenticated", async () => {
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .send({ content: "hi" });
      expect(res.status).toBe(401);
    });

    it("returns 403 when caller is not a member", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([]);
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(outsiderToken))
        .send({ content: "hi" });
      expect(res.status).toBe(403);
    });

    it("validates content", async () => {
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(memberToken))
        .send({ content: "" });
      expect(res.status).toBe(400);
    });

    it("creates a team comment tagged with team_id and visibility=team", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      mock.queueSelect([{ id: storyId }]);
      mock.queueInsert([{ id: "c-new" }]);
      mock.queueSelect([
        {
          id: "c-new",
          storyId,
          teamId,
          userId: memberId,
          parentCommentId: null,
          content: "first take",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          authorName: "Member",
          authorEmail: memberEmail,
        },
      ]);

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(memberToken))
        .send({ content: "first take" });

      expect(res.status).toBe(201);
      expect(res.body.data.comment.team_id).toBe(teamId);
      expect(res.body.data.comment.content).toBe("first take");
    });

    it("rejects parent comment from a different team", async () => {
      const parentId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      mock.queueSelect([{ id: storyId }]);
      mock.queueSelect([
        { id: parentId, storyId, teamId: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
      ]);

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/stories/${storyId}/comments`)
        .set(...auth(memberToken))
        .send({ content: "reply", parent_comment_id: parentId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PARENT_MISMATCH");
    });
  });

  // ---------- Phase 9b-1: team settings ----------

  describe("PATCH /api/v1/teams/:team_id/settings", () => {
    it("returns 403 when non-admin member attempts update", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}/settings`)
        .set(...auth(memberToken))
        .send({ sectors: ["ai"] });
      expect(res.status).toBe(403);
    });

    it("validates sectors must be an array", async () => {
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}/settings`)
        .set(...auth(adminToken))
        .send({ sectors: "ai" });
      expect(res.status).toBe(400);
    });

    it("updates sectors when admin and deduplicates", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([
        teamRow({ settings: { sectors: ["ai", "finance"] } }),
      ]);

      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}/settings`)
        .set(...auth(adminToken))
        .send({ sectors: ["ai", "finance", "ai"] });

      expect(res.status).toBe(200);
      expect(res.body.data.team.settings.sectors).toEqual(["ai", "finance"]);
      expect(mock.state.updatedRows[0].settings.sectors).toEqual([
        "ai",
        "finance",
      ]);
    });

    it("returns 404 when team not found", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .patch(`/api/v1/teams/${teamId}/settings`)
        .set(...auth(adminToken))
        .send({ sectors: ["ai"] });
      expect(res.status).toBe(404);
    });
  });

  // ---------- Phase 9b-1: team dashboard ----------

  describe("GET /api/v1/teams/:team_id/dashboard", () => {
    it("rejects unauthenticated", async () => {
      const res = await request(app).get(`/api/v1/teams/${teamId}/dashboard`);
      expect(res.status).toBe(401);
    });

    it("returns 403 when caller is not a member", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: ["ai"] } })]);
      mock.queueSelect([]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/dashboard`)
        .set(...auth(outsiderToken));
      expect(res.status).toBe(403);
    });

    it("returns aggregates using team-member saves (not sector-based)", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: ["ai", "finance"] } })]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([{ count: 3 }]); // member count
      mock.queueSelect([{ count: 7 }]); // team comment count
      mock.queueSelect([{ count: 12 }]); // total saves via team_members join
      mock.queueSelect([
        { sector: "ai", count: 5 },
        { sector: "finance", count: 2 },
      ]);
      mock.queueSelect([
        { id: storyId, headline: "Top", sector: "ai", saveCount: 4 },
      ]);

      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/dashboard`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.member_count).toBe(3);
      expect(res.body.data.total_comments).toBe(7);
      expect(res.body.data.total_saves).toBe(12);
      expect(res.body.data.stories_by_sector).toHaveLength(2);
      expect(res.body.data.top_saved_stories[0].save_count).toBe(4);
    });

    it("handles empty sectors without issuing the stories_by_sector query", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: [] } })]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([{ count: 2 }]);
      mock.queueSelect([{ count: 0 }]);
      mock.queueSelect([{ count: 0 }]);
      // stories_by_sector skipped when sectors empty
      mock.queueSelect([]); // top saved stories

      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/dashboard`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.sectors).toEqual([]);
      expect(res.body.data.stories_by_sector).toEqual([]);
    });

    it("returns 403 with 'Admin role required' when caller is a non-admin member", async () => {
      mock.queueSelect([teamRow({ settings: { sectors: ["ai"] } })]);
      mock.queueSelect([{ id: "m1", role: "member" }]);

      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/dashboard`)
        .set(...auth(memberToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(res.body.error.message).toBe("Admin role required");
    });
  });

  // ---------- Phase 9b-3: invite metadata ----------

  describe("GET /api/v1/teams/invite/metadata", () => {
    it("returns 400 for an invalid token signature", async () => {
      const res = await request(app).get(
        "/api/v1/teams/invite/metadata?token=bogus.token",
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INVITE");
    });

    it("returns metadata with status=valid for a live invite", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([{ id: teamId, name: "Acme", slug: "acme" }]);

      const res = await request(app).get(
        `/api/v1/teams/invite/metadata?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("valid");
      expect(res.body.data.team_name).toBe("Acme");
      expect(res.body.data.email).toBe(inviteeEmail);
      expect(res.body.data.role).toBe("member");
    });

    it("returns status=expired without error for a DB-expired invite", async () => {
      // Token signed with long TTL so signature verifies; DB row has past expiresAt.
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() - 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([{ id: teamId, name: "Acme", slug: "acme" }]);

      const res = await request(app).get(
        `/api/v1/teams/invite/metadata?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("expired");
    });

    it("returns status=expired (not 400) when the token's own TTL has also elapsed", async () => {
      // HMAC signature verifies but the token's embedded expiresAt is in the past.
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
        now: Date.now() - 60_000,
        ttlMs: 1,
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() - 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([{ id: teamId, name: "Acme", slug: "acme" }]);

      const res = await request(app).get(
        `/api/v1/teams/invite/metadata?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("expired");
    });

    it("returns status=used without error for a consumed invite", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
        },
      ]);
      mock.queueSelect([{ id: teamId, name: "Acme", slug: "acme" }]);

      const res = await request(app).get(
        `/api/v1/teams/invite/metadata?token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("used");
    });
  });

  // ---------- Phase 9b-3: invite accept ----------

  describe("POST /api/v1/teams/invite/accept", () => {
    it("returns 400 for an invalid token signature", async () => {
      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token: "bogus.token", password: "longenough", name: "New User" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INVITE");
    });

    it("returns 410 for a used invite (replay)", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
        },
      ]);
      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "longenough" });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITE_USED");
    });

    it("returns 410 when DB marks the invite expired", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() - 60_000),
          usedAt: null,
        },
      ]);
      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "longenough" });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITE_EXPIRED");
    });

    it("returns 410 INVITE_EXPIRED (not 400) when the token's own TTL has also elapsed", async () => {
      // Token signed in the past with a 1ms TTL — HMAC signature still verifies,
      // but its embedded expiresAt is long past, matching the DB row's expiry.
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
        now: Date.now() - 60_000,
        ttlMs: 1,
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() - 60_000),
          usedAt: null,
        },
      ]);
      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "longenough" });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITE_EXPIRED");
    });

    it("creates a new user and joins the team when no user exists", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      // 1) invite row lookup
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      // 2) existingUser lookup — none
      mock.queueSelect([]);
      // 3) inside txn: insert user → returning([...])
      mock.queueInsert([{ id: outsiderId, email: inviteeEmail, name: "Newbie" }]);
      // 4) loadTeam (after accept) — first the team row fetch
      mock.queueSelect([{ id: teamId, name: "Acme", slug: "acme" }]);

      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "longenough", name: "Newbie" });

      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(true);
      expect(res.body.data.user.email).toBe(inviteeEmail);
      expect(res.body.data.user.name).toBe("Newbie");
      expect(res.body.data.team.id).toBe(teamId);
      expect(res.body.data.role).toBe("member");
      expect(typeof res.body.data.token).toBe("string");
      expect(mock.state.updatedRows).toHaveLength(1);
      expect(mock.state.updatedRows[0]).toHaveProperty("usedAt");
    });

    it("requires password + name when creating a new user", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      // no existing user
      mock.queueSelect([]);

      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "longenough" }); // missing name
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("SIGNUP_REQUIRED");
    });

    it("authenticates an existing user with matching password and joins the team", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      const passwordHash = await hashPassword("longenough");

      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([
        {
          id: outsiderId,
          email: inviteeEmail,
          name: "Invitee",
          passwordHash,
        },
      ]);
      // inside txn: membership lookup (none) → insert member happens
      mock.queueSelect([]);
      // loadTeam team row after accept
      mock.queueSelect([{ id: teamId, name: "Acme", slug: "acme" }]);

      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "longenough" });

      expect(res.status).toBe(200);
      expect(res.body.data.created).toBe(false);
      expect(res.body.data.user.id).toBe(outsiderId);
      expect(typeof res.body.data.token).toBe("string");
      expect(mock.state.updatedRows).toHaveLength(1);
    });

    it("rejects an existing user with a wrong password", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      const passwordHash = await hashPassword("correcthorse");

      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      mock.queueSelect([
        {
          id: outsiderId,
          email: inviteeEmail,
          name: "Invitee",
          passwordHash,
        },
      ]);

      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .send({ token, password: "wrongpassword" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects a logged-in user whose JWT email does not match the invite", async () => {
      const { token } = signInviteToken({
        teamId,
        email: inviteeEmail,
        role: "member",
      });
      mock.queueSelect([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
        },
      ]);
      const wrongToken = generateToken(outsiderId, "someone-else@example.com");
      const res = await request(app)
        .post("/api/v1/teams/invite/accept")
        .set(...auth(wrongToken))
        .send({ token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVITE_EMAIL_MISMATCH");
    });
  });

  // ---------- Phase 9b-3: invites management ----------

  describe("GET /api/v1/teams/:team_id/invites", () => {
    it("returns 403 for non-admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(memberToken));
      expect(res.status).toBe(403);
    });

    it("returns invites with derived status for admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([
        {
          id: inviteId,
          email: "a@example.com",
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
          createdAt: new Date(),
          invitedBy: adminId,
        },
        {
          id: "ddddddddd-dddd-dddd-dddd-dddddddddddd",
          email: "b@example.com",
          role: "viewer",
          expiresAt: new Date(Date.now() - 60_000),
          usedAt: null,
          createdAt: new Date(),
          invitedBy: adminId,
        },
        {
          id: "eeeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
          email: "c@example.com",
          role: "member",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
          createdAt: new Date(),
          invitedBy: adminId,
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/teams/${teamId}/invites`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
      const { invites } = res.body.data;
      expect(invites).toHaveLength(3);
      expect(invites[0].status).toBe("pending");
      expect(invites[1].status).toBe("expired");
      expect(invites[2].status).toBe("used");
    });
  });

  describe("POST /api/v1/teams/:team_id/invites/:invite_id/resend", () => {
    const existingInviteId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    it("returns 403 for non-admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites/${existingInviteId}/resend`)
        .set(...auth(memberToken));
      expect(res.status).toBe(403);
    });

    it("marks the old invite used and issues a new one", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([
        {
          id: existingInviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          usedAt: null,
        },
      ]);
      // Inside txn: update old (tracked) then insert new → returning.
      mock.queueInsert([
        {
          id: inviteId,
          teamId,
          email: inviteeEmail,
          role: "member",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          usedAt: null,
        },
      ]);
      // Inviter lookup
      mock.queueSelect([{ name: "Admin", email: adminEmail }]);

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/invites/${existingInviteId}/resend`)
        .set(...auth(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.data.invite.email).toBe(inviteeEmail);
      expect(res.body.data.invite.role).toBe("member");
      // Old invite was marked used inside the txn.
      expect(mock.state.updatedRows).toHaveLength(1);
      expect(mock.state.updatedRows[0]).toHaveProperty("usedAt");
    });
  });

  describe("DELETE /api/v1/teams/:team_id/invites/:invite_id", () => {
    const targetInviteId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    it("returns 403 for non-admin", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "member" }]);
      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/invites/${targetInviteId}`)
        .set(...auth(memberToken));
      expect(res.status).toBe(403);
    });

    it("soft-deletes a pending invite so its token is no longer accepted", async () => {
      mock.queueSelect([teamRow()]);
      mock.queueSelect([{ id: "m1", role: "admin" }]);
      mock.queueSelect([
        { id: targetInviteId, teamId, usedAt: null },
      ]);

      const res = await request(app)
        .delete(`/api/v1/teams/${teamId}/invites/${targetInviteId}`)
        .set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(mock.state.updatedRows).toHaveLength(1);
      expect(mock.state.updatedRows[0]).toHaveProperty("usedAt");
    });
  });
});
