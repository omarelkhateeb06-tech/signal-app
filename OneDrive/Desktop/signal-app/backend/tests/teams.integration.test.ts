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
import { generateToken } from "../src/services/authService";
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
});
