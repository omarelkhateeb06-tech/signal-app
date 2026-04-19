import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { userProfiles, users } from "../db/schema";
import { renderWelcomeEmail } from "../emails/welcomeEmail";
import { enqueueEmail } from "../jobs/emailQueue";
import { AppError } from "../middleware/errorHandler";
import {
  generateToken,
  hashPassword,
  verifyPassword,
} from "../services/authService";
import { buildUnsubscribeUrl } from "../services/unsubscribeService";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface PublicUser {
  id: string;
  email: string;
  name: string | null;
}

function toPublicUser(row: { id: string; email: string; name: string | null }): PublicUser {
  return { id: row.id, email: row.email, name: row.name };
}

export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, name } = signupSchema.parse(req.body);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      throw new AppError("EMAIL_TAKEN", "Email is already registered", 409);
    }

    const passwordHash = await hashPassword(password);

    const inserted = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email, passwordHash, name })
        .returning({ id: users.id, email: users.email, name: users.name });
      if (!user) {
        throw new AppError("SIGNUP_FAILED", "Failed to create user", 500);
      }
      await tx.insert(userProfiles).values({ userId: user.id });
      return user;
    });

    const token = generateToken(inserted.id, inserted.email);

    void queueWelcomeEmail(inserted);

    res.status(201).json({ data: { user: toPublicUser(inserted), token } });
  } catch (error) {
    next(error);
  }
}

async function queueWelcomeEmail(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<void> {
  try {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const unsubscribeUrl = buildUnsubscribeUrl(user.id, frontendUrl);
    const rendered = renderWelcomeEmail({
      name: user.name,
      email: user.email,
      frontendUrl,
      unsubscribeUrl,
    });
    await enqueueEmail({
      type: "welcome",
      payload: {
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        categories: ["welcome"],
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[signal-backend] welcome email enqueue failed:", err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }
    if (user.status !== "active") {
      throw new AppError("ACCOUNT_INACTIVE", "Account is not active", 403);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const token = generateToken(user.id, user.email);
    res.json({ data: { user: toPublicUser(user), token } });
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
    }
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, req.user.userId))
      .limit(1);
    if (!user) {
      throw new AppError("USER_NOT_FOUND", "User not found", 404);
    }
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id))
      .limit(1);

    res.json({ data: { user: toPublicUser(user), profile: profile ?? null } });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response): void {
  res.json({ data: { success: true } });
}
