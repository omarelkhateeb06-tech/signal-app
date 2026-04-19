import type { NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  comments,
  stories,
  teams,
  teamMembers,
  teamInvites,
  userProfiles,
  userSaves,
  users,
  writers,
  type TeamSettings,
} from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import {
  INVITE_TOKEN_TTL_MS,
  buildInviteUrl,
  normalizeEmail,
  signInviteToken,
  verifyInviteToken,
  type InviteRole,
} from "../services/teamInviteService";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  verifyToken,
  type JwtPayload,
} from "../services/authService";
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
  settings: TeamSettings;
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
      settings: teams.settings,
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
  return { ...row, settings: row.settings ?? { sectors: [] } };
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
    settings: row.settings,
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
        settings: teams.settings,
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
      settings: r.settings ?? { sectors: [] },
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

// ---------- Phase 9b-1: team-scoped content ----------

const FEED_MAX_LIMIT = 50;
const FEED_DEFAULT_LIMIT = 10;
const COMMENT_MAX_LIMIT = 50;
const COMMENT_DEFAULT_LIMIT = 20;
const COMMENT_MAX_CONTENT = 2000;
const SECTOR_MAX = 50;
const SECTORS_MAX_COUNT = 20;

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

const commentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(COMMENT_MAX_LIMIT).default(COMMENT_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

const teamStoryParamSchema = z.object({
  team_id: z.string().uuid(),
  story_id: z.string().uuid(),
});

const createTeamCommentSchema = z.object({
  content: z.string().trim().min(1).max(COMMENT_MAX_CONTENT),
  parent_comment_id: z.string().uuid().optional().nullable(),
});

const updateSettingsSchema = z.object({
  sectors: z
    .array(z.string().trim().min(1).max(SECTOR_MAX))
    .max(SECTORS_MAX_COUNT),
});

export async function getTeamFeed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    const { limit, offset } = feedQuerySchema.parse(req.query);

    const team = await loadTeam(teamId);
    await requireMembership(teamId, userId);

    const sectors = team.settings.sectors;
    if (sectors.length === 0) {
      res.json({
        data: { stories: [], total: 0, has_more: false, limit, offset },
      });
      return;
    }

    const rows = await db
      .select({
        id: stories.id,
        sector: stories.sector,
        headline: stories.headline,
        context: stories.context,
        whyItMatters: stories.whyItMatters,
        sourceUrl: stories.sourceUrl,
        sourceName: stories.sourceName,
        publishedAt: stories.publishedAt,
        createdAt: stories.createdAt,
        authorId: writers.id,
        authorName: writers.name,
        saveCount: sql<number>`(SELECT COUNT(*)::int FROM user_saves us WHERE us.story_id = ${stories.id})`,
        commentCount: sql<number>`(SELECT COUNT(*)::int FROM comments c WHERE c.story_id = ${stories.id} AND c.team_id = ${teamId} AND c.deleted_at IS NULL)`,
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(inArray(stories.sector, sectors))
      .orderBy(desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`))
      .limit(limit)
      .offset(offset);

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(stories)
      .where(inArray(stories.sector, sectors));
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((r) => ({
      id: r.id,
      sector: r.sector,
      headline: r.headline,
      context: r.context,
      why_it_matters: r.whyItMatters,
      source_url: r.sourceUrl,
      source_name: r.sourceName,
      published_at: r.publishedAt,
      created_at: r.createdAt,
      author: r.authorId ? { id: r.authorId, name: r.authorName } : null,
      save_count: Number(r.saveCount ?? 0),
      team_comment_count: Number(r.commentCount ?? 0),
    }));

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: offset + rows.length < total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listTeamStoryComments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId, story_id: storyId } = teamStoryParamSchema.parse(
      req.params,
    );
    const { limit, offset } = commentsQuerySchema.parse(req.query);

    await loadTeam(teamId);
    await requireMembership(teamId, userId);

    const [story] = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }

    const rows = await db
      .select({
        id: comments.id,
        storyId: comments.storyId,
        teamId: comments.teamId,
        userId: comments.userId,
        parentCommentId: comments.parentCommentId,
        content: comments.content,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        deletedAt: comments.deletedAt,
        authorName: users.name,
        authorEmail: users.email,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(
        and(
          eq(comments.storyId, storyId),
          eq(comments.teamId, teamId),
        ),
      )
      .orderBy(asc(comments.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(comments)
      .where(
        and(eq(comments.storyId, storyId), eq(comments.teamId, teamId)),
      );
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((r) => {
      const isDeleted = Boolean(r.deletedAt);
      return {
        id: r.id,
        story_id: r.storyId,
        team_id: r.teamId,
        parent_comment_id: r.parentCommentId,
        content: isDeleted ? "[deleted]" : r.content,
        is_deleted: isDeleted,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        author: { id: r.userId, name: r.authorName, email: r.authorEmail },
      };
    });

    res.json({
      data: {
        comments: shaped,
        total,
        has_more: offset + rows.length < total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createTeamStoryComment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId, story_id: storyId } = teamStoryParamSchema.parse(
      req.params,
    );
    const { content, parent_comment_id: parentCommentId } =
      createTeamCommentSchema.parse(req.body);

    await loadTeam(teamId);
    await requireMembership(teamId, userId);

    const [story] = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }

    if (parentCommentId) {
      const [parent] = await db
        .select({
          id: comments.id,
          storyId: comments.storyId,
          teamId: comments.teamId,
        })
        .from(comments)
        .where(eq(comments.id, parentCommentId))
        .limit(1);
      if (!parent) {
        throw new AppError("PARENT_NOT_FOUND", "Parent comment not found", 404);
      }
      if (parent.storyId !== storyId || parent.teamId !== teamId) {
        throw new AppError(
          "PARENT_MISMATCH",
          "Parent comment belongs to a different story or team",
          400,
        );
      }
    }

    const [inserted] = await db
      .insert(comments)
      .values({
        storyId,
        userId,
        teamId,
        visibility: "team",
        content,
        parentCommentId: parentCommentId ?? null,
      })
      .returning();

    const [row] = await db
      .select({
        id: comments.id,
        storyId: comments.storyId,
        teamId: comments.teamId,
        userId: comments.userId,
        parentCommentId: comments.parentCommentId,
        content: comments.content,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        deletedAt: comments.deletedAt,
        authorName: users.name,
        authorEmail: users.email,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.id, inserted.id))
      .limit(1);

    res.status(201).json({
      data: {
        comment: {
          id: row.id,
          story_id: row.storyId,
          team_id: row.teamId,
          parent_comment_id: row.parentCommentId,
          content: row.content,
          is_deleted: false,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
          author: {
            id: row.userId,
            name: row.authorName,
            email: row.authorEmail,
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateTeamSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    const body = updateSettingsSchema.parse(req.body);

    await loadTeam(teamId);
    await requireAdmin(teamId, userId);

    const unique = Array.from(new Set(body.sectors));
    const nextSettings: TeamSettings = { sectors: unique };

    await db
      .update(teams)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(teams.id, teamId));

    const row = await loadTeam(teamId);
    res.json({ data: { team: { ...shapeTeam(row), role: "admin" } } });
  } catch (error) {
    next(error);
  }
}

export async function getTeamDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);

    const team = await loadTeam(teamId);
    await requireAdmin(teamId, userId);

    const [memberCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    const memberCount = Number(memberCountRow?.count ?? 0);

    const [commentCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(comments)
      .where(
        and(eq(comments.teamId, teamId), isNull(comments.deletedAt)),
      );
    const commentCount = Number(commentCountRow?.count ?? 0);

    const [saveCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userSaves)
      .innerJoin(teamMembers, eq(teamMembers.userId, userSaves.userId))
      .where(eq(teamMembers.teamId, teamId));
    const totalSaves = Number(saveCountRow?.count ?? 0);

    const sectors = team.settings.sectors;
    const storiesBySector = sectors.length
      ? await db
          .select({
            sector: stories.sector,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(stories)
          .where(inArray(stories.sector, sectors))
          .groupBy(stories.sector)
      : [];

    const topSavedRows = await db
      .select({
        id: stories.id,
        headline: stories.headline,
        sector: stories.sector,
        saveCount: sql<number>`COUNT(${userSaves.id})::int`,
      })
      .from(stories)
      .innerJoin(userSaves, eq(userSaves.storyId, stories.id))
      .innerJoin(teamMembers, eq(teamMembers.userId, userSaves.userId))
      .where(eq(teamMembers.teamId, teamId))
      .groupBy(stories.id, stories.headline, stories.sector)
      .orderBy(desc(sql`COUNT(${userSaves.id})`))
      .limit(5);

    res.json({
      data: {
        team_id: teamId,
        member_count: memberCount,
        total_comments: commentCount,
        total_saves: totalSaves,
        sectors,
        stories_by_sector: storiesBySector.map((r) => ({
          sector: r.sector,
          count: Number(r.count ?? 0),
        })),
        top_saved_stories: topSavedRows.map((r) => ({
          id: r.id,
          headline: r.headline,
          sector: r.sector,
          save_count: Number(r.saveCount ?? 0),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

// ---------- Phase 9b-3: invite accept/metadata + invites management ----------

const inviteIdParamSchema = z.object({
  team_id: z.string().uuid(),
  invite_id: z.string().uuid(),
});

const inviteMetadataQuerySchema = z.object({ token: z.string().min(10) });

const inviteAcceptSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).optional(),
  name: z.string().trim().min(1).optional(),
});

type InviteStatus = "pending" | "expired" | "used";

function deriveInviteStatus(row: {
  usedAt: Date | null;
  expiresAt: Date;
}): InviteStatus {
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "pending";
}

export async function inviteMetadata(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = inviteMetadataQuerySchema.parse(req.query);

    // Pass now=0 to bypass expiry check — we want to return metadata even for
    // expired tokens (with status="expired"). Signature is still verified.
    const verified = verifyInviteToken(token, 0);
    if (!verified) {
      throw new AppError(
        "INVITE_SIGNATURE_INVALID",
        "Invite signature invalid",
        400,
      );
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
      throw new AppError("INVITE_NOT_FOUND", "Invite not found", 404);
    }

    const [teamRow] = await db
      .select({ id: teams.id, name: teams.name, slug: teams.slug })
      .from(teams)
      .where(eq(teams.id, inviteRow.teamId))
      .limit(1);

    if (!teamRow) {
      throw new AppError("TEAM_NOT_FOUND", "Team not found", 404);
    }

    const status: InviteStatus = deriveInviteStatus({
      usedAt: inviteRow.usedAt,
      expiresAt: inviteRow.expiresAt,
    });

    res.json({
      data: {
        team_name: teamRow.name,
        team_slug: teamRow.slug,
        email: inviteRow.email,
        role: inviteRow.role,
        expires_at: inviteRow.expiresAt,
        status: status === "pending" ? "valid" : status,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function inviteAccept(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = inviteAcceptSchema.parse(req.body);
    const { token, password, name } = body;

    // Bypass HMAC expiry so the DB row is the single source of truth for
    // "expired" vs "invalid" — callers get INVITE_EXPIRED (410) rather than
    // the ambiguous INVALID_INVITE (400) once the TTL elapses. Signature is
    // still verified for tamper protection.
    const verified = verifyInviteToken(token, 0);
    if (!verified) {
      throw new AppError(
        "INVITE_SIGNATURE_INVALID",
        "Invite signature invalid",
        400,
      );
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
      throw new AppError("INVITE_NOT_FOUND", "Invite not found", 404);
    }
    if (inviteRow.usedAt) {
      throw new AppError("INVITE_USED", "Invite has already been used", 410);
    }
    if (inviteRow.expiresAt.getTime() <= Date.now()) {
      throw new AppError("INVITE_EXPIRED", "Invite has expired", 410);
    }

    const inviteEmail = inviteRow.email.toLowerCase();

    // Optional Authorization header — if present and valid, skip the password
    // path. If present but email mismatches the invite, hard-fail so a logged-in
    // user doesn't accidentally consume an invite for a different identity.
    let authedPayload: JwtPayload | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        authedPayload = verifyToken(authHeader.slice(7));
      } catch {
        authedPayload = null;
      }
      if (authedPayload && authedPayload.email.toLowerCase() !== inviteEmail) {
        throw new AppError(
          "INVITE_EMAIL_MISMATCH",
          "Authenticated email does not match invite",
          403,
        );
      }
    }

    const [existingUser] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, inviteEmail))
      .limit(1);

    let acceptedUser: { id: string; email: string; name: string | null };
    let created = false;

    if (authedPayload) {
      if (!existingUser || existingUser.id !== authedPayload.userId) {
        throw new AppError(
          "INVITE_EMAIL_MISMATCH",
          "Authenticated user does not match invite",
          403,
        );
      }
      acceptedUser = {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
      };
      await db.transaction(async (tx) => {
        const [membership] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, inviteRow.teamId),
              eq(teamMembers.userId, acceptedUser.id),
            ),
          )
          .limit(1);
        if (!membership) {
          await tx.insert(teamMembers).values({
            teamId: inviteRow.teamId,
            userId: acceptedUser.id,
            role: inviteRow.role,
          });
        }
        await tx
          .update(teamInvites)
          .set({ usedAt: new Date() })
          .where(eq(teamInvites.id, inviteRow.id));
      });
    } else if (existingUser) {
      if (!password) {
        throw new AppError("PASSWORD_REQUIRED", "Password required to accept invite", 401);
      }
      if (!existingUser.passwordHash) {
        throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
      }
      const ok = await verifyPassword(password, existingUser.passwordHash);
      if (!ok) {
        throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
      }
      acceptedUser = {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
      };
      await db.transaction(async (tx) => {
        const [membership] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, inviteRow.teamId),
              eq(teamMembers.userId, acceptedUser.id),
            ),
          )
          .limit(1);
        if (!membership) {
          await tx.insert(teamMembers).values({
            teamId: inviteRow.teamId,
            userId: acceptedUser.id,
            role: inviteRow.role,
          });
        }
        await tx
          .update(teamInvites)
          .set({ usedAt: new Date() })
          .where(eq(teamInvites.id, inviteRow.id));
      });
    } else {
      if (!password || !name) {
        throw new AppError(
          "SIGNUP_REQUIRED",
          "password and name are required to sign up",
          400,
        );
      }
      // Hash outside the txn — pure CPU, no DB work, matches authController.
      const passwordHash = await hashPassword(password);
      const createdUser = await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(users)
          .values({ email: inviteEmail, passwordHash, name })
          .returning({ id: users.id, email: users.email, name: users.name });
        if (!newUser) {
          throw new AppError("SIGNUP_FAILED", "Failed to create user", 500);
        }
        await tx.insert(userProfiles).values({ userId: newUser.id });
        await tx.insert(teamMembers).values({
          teamId: inviteRow.teamId,
          userId: newUser.id,
          role: inviteRow.role,
        });
        await tx
          .update(teamInvites)
          .set({ usedAt: new Date() })
          .where(eq(teamInvites.id, inviteRow.id));
        return newUser;
      });
      acceptedUser = createdUser;
      created = true;
    }

    const [teamRow] = await db
      .select({ id: teams.id, name: teams.name, slug: teams.slug })
      .from(teams)
      .where(eq(teams.id, inviteRow.teamId))
      .limit(1);
    if (!teamRow) {
      throw new AppError("TEAM_NOT_FOUND", "Team not found", 404);
    }

    const jwt = generateToken(acceptedUser.id, acceptedUser.email);

    res.status(created ? 201 : 200).json({
      data: {
        token: jwt,
        user: {
          id: acceptedUser.id,
          email: acceptedUser.email,
          name: acceptedUser.name,
        },
        team: { id: teamRow.id, name: teamRow.name, slug: teamRow.slug },
        role: inviteRow.role,
        created,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listInvites(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actingUserId = requireUserId(req);
    const { team_id: teamId } = teamIdParamSchema.parse(req.params);
    await loadTeam(teamId);
    await requireAdmin(teamId, actingUserId);

    const rows = await db
      .select({
        id: teamInvites.id,
        email: teamInvites.email,
        role: teamInvites.role,
        expiresAt: teamInvites.expiresAt,
        usedAt: teamInvites.usedAt,
        createdAt: teamInvites.createdAt,
        invitedBy: teamInvites.invitedBy,
      })
      .from(teamInvites)
      .where(eq(teamInvites.teamId, teamId))
      .orderBy(desc(teamInvites.createdAt));

    const invites = rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      expires_at: r.expiresAt,
      used_at: r.usedAt,
      created_at: r.createdAt,
      invited_by: r.invitedBy,
      status: deriveInviteStatus({ usedAt: r.usedAt, expiresAt: r.expiresAt }),
    }));

    res.json({ data: { invites } });
  } catch (error) {
    next(error);
  }
}

export async function resendInvite(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actingUserId = requireUserId(req);
    const { team_id: teamId, invite_id: inviteId } =
      inviteIdParamSchema.parse(req.params);

    const team = await loadTeam(teamId);
    await requireAdmin(teamId, actingUserId);

    const [existing] = await db
      .select({
        id: teamInvites.id,
        teamId: teamInvites.teamId,
        email: teamInvites.email,
        role: teamInvites.role,
        usedAt: teamInvites.usedAt,
      })
      .from(teamInvites)
      .where(eq(teamInvites.id, inviteId))
      .limit(1);

    if (!existing || existing.teamId !== teamId) {
      throw new AppError("INVITE_NOT_FOUND", "Invite not found", 404);
    }

    const email = existing.email.toLowerCase();
    const role = existing.role as InviteRole;

    const { token, expiresAt } = signInviteToken({ teamId, email, role });

    const newInviteRow = await db.transaction(async (tx) => {
      // Mark the old invite as used to invalidate the previous token.
      await tx
        .update(teamInvites)
        .set({ usedAt: new Date() })
        .where(eq(teamInvites.id, existing.id));
      const [inserted] = await tx
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
      return inserted;
    });

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
      // eslint-disable-next-line no-console
      console.warn("[signal-backend] team-invite resend email dispatch failed", err);
    });

    res.json({
      data: {
        invite: {
          id: newInviteRow.id,
          team_id: teamId,
          email,
          role,
          expires_at: newInviteRow.expiresAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeInvite(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actingUserId = requireUserId(req);
    const { team_id: teamId, invite_id: inviteId } =
      inviteIdParamSchema.parse(req.params);

    await loadTeam(teamId);
    await requireAdmin(teamId, actingUserId);

    const [existing] = await db
      .select({
        id: teamInvites.id,
        teamId: teamInvites.teamId,
        usedAt: teamInvites.usedAt,
      })
      .from(teamInvites)
      .where(eq(teamInvites.id, inviteId))
      .limit(1);

    if (!existing || existing.teamId !== teamId) {
      throw new AppError("INVITE_NOT_FOUND", "Invite not found", 404);
    }

    if (!existing.usedAt) {
      await db
        .update(teamInvites)
        .set({ usedAt: new Date() })
        .where(eq(teamInvites.id, inviteId));
    }

    res.json({ data: { success: true, id: inviteId } });
  } catch (error) {
    next(error);
  }
}
