import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { teams, teamMembers, teamInvites, users } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import {
  INVITE_TOKEN_TTL_MS,
  buildInviteUrl,
  normalizeEmail,
  signInviteToken,
  verifyInviteToken,
  type InviteRole,
} from "../services/teamInviteService";
import { enqueueEmail } from "../jobs/emailQueue";
import { renderTeamInviteEmail } from "../emails/teamInviteEmail";

const NAME_MAX = 255;
const DESCRIPTION_MAX = 500;
const SLUG_MAX = 100;
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;
const EMAIL_MAX = 255;

const roleSchema = z.enum(["admin", "member", "viewer"]);

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(SLUG_MAX)
    .regex(SLUG_REGEX, "slug must be lowercase letters, numbers, or hyphens"),
  description: z.string().trim().max(DESCRIPTION_MAX).optional().nullable(),
});

const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
    description: z.string().trim().max(DESCRIPTION_MAX).optional().nullable(),
    slug: z.string().trim().min(3).max(SLUG_MAX).regex(SLUG_REGEX).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(EMAIL_MAX),
  role: roleSchema.default("member"),
});

const joinSchema = z.object({ token: z.string().min(10) });

const teamIdParamSchema = z.object({ team_id: z.string().uuid() });
const memberParamSchema = z.object({
  team_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

type MembershipRole = "admin" | "member" | "viewer";

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

function requireUserEmail(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.email;
}

async function loadTeam(teamId: string): Promise<{
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}> {
  const [row] = await db
    .select({
      id: teams.id,
      name: teams.name,
      slug: teams.slug,
      description: teams.description,
      createdBy: teams.createdBy,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
      deletedAt: teams.deletedAt,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row || row.deletedAt) {
    throw new AppError("TEAM_NOT_FOUND", "Team not found", 404);
  }
  return row;
}

async function getMembership(
  teamId: string,
  userId: string,
): Promise<{ id: string; role: MembershipRole } | null> {
  const [row] = await db
    .select({ id: teamMembers.id, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return row ? { id: row.id, role: row.role as MembershipRole } : null;
}

async function requireMembership(
  teamId: string,
  userId: string,
): Promise<MembershipRole> {
  const membership = await getMembership(teamId, userId);
  if (!membership) {
    throw new AppError("FORBIDDEN", "Not a member of this team", 403);
  }
  return membership.role;
}

async function requireAdmin(teamId: string, userId: string): Promise<void> {
  const role = await requireMembership(teamId, userId);
  if (role !== "admin") {
    throw new AppError("FORBIDDEN", "Admin role required", 403);
  }
}

function shapeTeam(row: Awaited<ReturnType<typeof loadTeam>>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function createTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = createTeamSchema.parse(req.body);

    const [existing] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.slug, body.slug))
      .limit(1);
    if (existing) {
      throw new AppError("SLUG_TAKEN", "Team slug already in use", 409);
    }

    const [inserted] = await db
      .insert(teams)
      .values({
        name: body.name,
        slug: body.slug,
        description: body.description ?? null,
        createdBy: userId,
      })
      .returning();

    await db.insert(teamMembers).values({
      teamId: inserted.id,
      userId,
      role: "admin",
    });

    const row = await loadTeam(inserted.id);
    res.status(201).json({ data: { team: { ...shapeTeam(row), role: "admin" } } });
  } catch (error) {
    next(error);
  }
}

export async function listTeams(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        description: teams.description,
        createdBy: teams.createdBy,
        createdAt: teams.createdAt,
        updatedAt: teams.updatedAt,
        deletedAt: teams.deletedAt,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.userId, userId), isNull(teams.deletedAt)))
      .orderBy(desc(teams.createdAt));

    const shaped = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      created_by: r.createdBy,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      role: r.role,
    }));

    res.json({ data: { teams: shaped } });
  } catch (error) {
    next(error);
  }
}

export async function getTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    const team = await loadTeam(teamId);
    const role = await requireMembership(teamId, userId);
    res.json({ data: { team: { ...shapeTeam(team), role } } });
  } catch (error) {
    next(error);
  }
}

export async function updateTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    const body = updateTeamSchema.parse(req.body);

    await loadTeam(teamId);
    await requireAdmin(teamId, userId);

    if (body.slug) {
      const [conflict] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.slug, body.slug), sql`${teams.id} <> ${teamId}`))
        .limit(1);
      if (conflict) {
        throw new AppError("SLUG_TAKEN", "Team slug already in use", 409);
      }
    }

    await db
      .update(teams)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description ?? null }
          : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, teamId));

    const row = await loadTeam(teamId);
    res.json({ data: { team: { ...shapeTeam(row), role: "admin" } } });
  } catch (error) {
    next(error);
  }
}

export async function deleteTeam(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    await loadTeam(teamId);
    await requireAdmin(teamId, userId);

    await db
      .update(teams)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(teams.id, teamId));

    res.json({ data: { id: teamId } });
  } catch (error) {
    next(error);
  }
}

export async function listMembers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    await loadTeam(teamId);
    await requireMembership(teamId, userId);

    const rows = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        role: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        email: users.email,
        name: users.name,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(teamMembers.joinedAt);

    const members = rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      role: r.role,
      joined_at: r.joinedAt,
      email: r.email,
      name: r.name,
    }));

    res.json({ data: { members } });
  } catch (error) {
    next(error);
  }
}

export async function removeMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actingUserId = requireUserId(req);
    const { team_id: teamId, user_id: targetUserId } = memberParamSchema.parse(req.params);
    await loadTeam(teamId);
    await requireAdmin(teamId, actingUserId);

    const target = await getMembership(teamId, targetUserId);
    if (!target) {
      throw new AppError("MEMBER_NOT_FOUND", "Member not found", 404);
    }

    if (target.role === "admin") {
      const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));
      const adminCount = Number(countRow?.count ?? 0);
      if (adminCount <= 1) {
        throw new AppError(
          "LAST_ADMIN",
          "Cannot remove the last admin of the team",
          400,
        );
      }
    }

    await db
      .delete(teamMembers)
      .where(
        and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)),
      );

    res.json({ data: { team_id: teamId, user_id: targetUserId } });
  } catch (error) {
    next(error);
  }
}

export async function invite(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actingUserId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    const body = inviteSchema.parse(req.body);

    const team = await loadTeam(teamId);
    await requireAdmin(teamId, actingUserId);

    const email = normalizeEmail(body.email);
    const role: InviteRole = body.role;

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingUser) {
      const existingMember = await getMembership(teamId, existingUser.id);
      if (existingMember) {
        throw new AppError("ALREADY_MEMBER", "User is already a team member", 409);
      }
    }

    const { token, expiresAt } = signInviteToken({ teamId, email, role });

    const [inviteRow] = await db
      .insert(teamInvites)
      .values({
        teamId,
        email,
        role,
        token,
        invitedBy: actingUserId,
        expiresAt,
      })
      .returning();

    const [inviter] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, actingUserId))
      .limit(1);

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const inviteUrl = buildInviteUrl(token, frontendUrl);
    const expiresInDays = Math.round(INVITE_TOKEN_TTL_MS / (24 * 60 * 60 * 1000));

    const rendered = renderTeamInviteEmail({
      inviteeEmail: email,
      teamName: team.name,
      inviterName: inviter?.name ?? null,
      role,
      inviteUrl,
      expiresInDays,
      frontendUrl,
    });

    await enqueueEmail({
      type: "team-invite",
      payload: {
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
    }).catch((err) => {
      // Graceful degradation: invite row persists even if email dispatch fails.
      // eslint-disable-next-line no-console
      console.warn("[signal-backend] team-invite email dispatch failed", err);
    });

    res.status(201).json({
      data: {
        invite: {
          id: inviteRow.id,
          team_id: teamId,
          email,
          role,
          expires_at: inviteRow.expiresAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function join(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const userEmail = requireUserEmail(req).toLowerCase();
    const { token } = joinSchema.parse(req.body);

    const verified = verifyInviteToken(token);
    if (!verified) {
      throw new AppError("INVALID_INVITE", "Invite is invalid or expired", 400);
    }

    const [inviteRow] = await db
      .select({
        id: teamInvites.id,
        teamId: teamInvites.teamId,
        email: teamInvites.email,
        role: teamInvites.role,
        expiresAt: teamInvites.expiresAt,
        usedAt: teamInvites.usedAt,
      })
      .from(teamInvites)
      .where(eq(teamInvites.token, token))
      .limit(1);

    if (!inviteRow) {
      throw new AppError("INVALID_INVITE", "Invite is invalid or expired", 400);
    }
    if (inviteRow.usedAt) {
      throw new AppError("INVITE_USED", "Invite has already been used", 410);
    }
    if (inviteRow.expiresAt.getTime() <= Date.now()) {
      throw new AppError("INVITE_EXPIRED", "Invite has expired", 410);
    }
    if (inviteRow.email.toLowerCase() !== userEmail) {
      throw new AppError(
        "INVITE_EMAIL_MISMATCH",
        "This invite was issued to a different email",
        403,
      );
    }

    await loadTeam(inviteRow.teamId);

    const existing = await getMembership(inviteRow.teamId, userId);
    if (existing) {
      await db
        .update(teamInvites)
        .set({ usedAt: new Date() })
        .where(eq(teamInvites.id, inviteRow.id));
      res.json({
        data: { team_id: inviteRow.teamId, role: existing.role, already_member: true },
      });
      return;
    }

    await db.insert(teamMembers).values({
      teamId: inviteRow.teamId,
      userId,
      role: inviteRow.role,
    });

    await db
      .update(teamInvites)
      .set({ usedAt: new Date() })
      .where(eq(teamInvites.id, inviteRow.id));

    res.status(201).json({
      data: {
        team_id: inviteRow.teamId,
        role: inviteRow.role,
        already_member: false,
      },
    });
  } catch (error) {
    next(error);
  }
}
