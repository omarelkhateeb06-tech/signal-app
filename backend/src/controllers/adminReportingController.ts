import type { NextFunction, Request, Response } from "express";
import { and, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  emailEvents,
  engagementEvents,
  productEvents,
  userProfiles,
  users,
} from "../db/schema";

// Phase 12w — admin reporting surface. Turns the captured data (product_events,
// signup attribution, firmographics, email_events, engagement_events) into the
// spec's audit numbers (growth / revenue / data-asset health / engagement).
// JSON-only for now; a dashboard UI is deferred. All routes sit behind
// requireAuth + requireAdmin (mounted under /admin). Read-only aggregates.

const DAY_MS = 24 * 60 * 60 * 1000;
const PRO_MONTHLY_PRICE_USD = 10;

// ?days= window for time-bounded reports. Clamped to [1, 365], default 30.
function clampDays(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 30;
  return Math.min(365, Math.max(1, n));
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

// Rate rounded to 4dp; 0 when the denominator is empty (avoids NaN/Infinity).
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

/** GET /admin/reports/growth?days=30 — signups, source breakdown, identified %. */
export async function getGrowthReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const days = clampDays(req.query.days);
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const [signups] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(users)
      .where(gte(users.createdAt, cutoff));

    const bySource = await db
      .select({ source: users.signupSource, c: sql<number>`count(*)::int` })
      .from(users)
      .where(gte(users.createdAt, cutoff))
      .groupBy(users.signupSource)
      .orderBy(sql`count(*) desc`);

    const [total] = await db.select({ c: sql<number>`count(*)::int` }).from(users);

    const [identified] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(userProfiles)
      .where(isNotNull(userProfiles.completedAt));

    const totalUsers = num(total?.c);
    const identifiedCount = num(identified?.c);

    res.json({
      data: {
        window_days: days,
        signups: num(signups?.c),
        by_source: bySource.map((r) => ({ source: r.source ?? "direct", count: num(r.c) })),
        total_users: totalUsers,
        identified_subscribers: identifiedCount,
        profile_completion_rate: ratio(identifiedCount, totalUsers),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/reports/revenue — tier counts, MRR estimate, paid conversion. */
export async function getRevenueReport(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await db
      .select({ tier: users.tier, c: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.tier);

    const tiers = { free: 0, pro_trial: 0, pro: 0 };
    for (const r of rows) {
      if (r.tier === "free" || r.tier === "pro_trial" || r.tier === "pro") {
        tiers[r.tier] = num(r.c);
      }
    }
    const paidBase = tiers.free + tiers.pro;

    res.json({
      data: {
        tiers,
        mrr_usd_estimate: tiers.pro * PRO_MONTHLY_PRICE_USD,
        paid_conversion_rate: ratio(tiers.pro, paidBase),
        note:
          "MRR assumes $10/mo per Pro; annual plans are not separated on users — see Stripe for exact MRR. paid_conversion_rate = pro / (free + pro), excluding active trials.",
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/reports/data-asset — identified base by sector/role/size + company completeness. */
export async function getDataAssetReport(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const completed = isNotNull(userProfiles.completedAt);

    const [identified] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(userProfiles)
      .where(completed);

    const bySector = await db
      .select({
        sector: sql<string>`unnest(${userProfiles.sectors})`,
        c: sql<number>`count(*)::int`,
      })
      .from(userProfiles)
      .where(completed)
      .groupBy(sql`1`)
      .orderBy(sql`count(*) desc`);

    const byRole = await db
      .select({ role: userProfiles.role, c: sql<number>`count(*)::int` })
      .from(userProfiles)
      .where(completed)
      .groupBy(userProfiles.role)
      .orderBy(sql`count(*) desc`);

    const byCompanySize = await db
      .select({ size: userProfiles.companySize, c: sql<number>`count(*)::int` })
      .from(userProfiles)
      .where(completed)
      .groupBy(userProfiles.companySize)
      .orderBy(sql`count(*) desc`);

    const [withCompany] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(userProfiles)
      .where(and(completed, isNotNull(userProfiles.company)));

    const identifiedCount = num(identified?.c);

    res.json({
      data: {
        identified_subscribers: identifiedCount,
        by_sector: bySector.map((r) => ({ sector: r.sector, count: num(r.c) })),
        by_role: byRole.map((r) => ({ role: r.role ?? "unknown", count: num(r.c) })),
        by_company_size: byCompanySize.map((r) => ({
          company_size: r.size ?? "unknown",
          count: num(r.c),
        })),
        company_completeness: ratio(num(withCompany?.c), identifiedCount),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/reports/engagement?days=30 — funnel, email open/CTOR, active readers. */
export async function getEngagementReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const days = clampDays(req.query.days);
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const funnelRows = await db
      .select({ event_type: productEvents.eventType, c: sql<number>`count(*)::int` })
      .from(productEvents)
      .where(gte(productEvents.createdAt, cutoff))
      .groupBy(productEvents.eventType);

    const emailRows = await db
      .select({ event_type: emailEvents.eventType, c: sql<number>`count(*)::int` })
      .from(emailEvents)
      .where(gte(emailEvents.occurredAt, cutoff))
      .groupBy(emailEvents.eventType);

    const [active] = await db
      .select({ c: sql<number>`count(distinct ${engagementEvents.userId})::int` })
      .from(engagementEvents)
      .where(gte(engagementEvents.createdAt, cutoff));

    const funnel: Record<string, number> = {};
    for (const r of funnelRows) funnel[r.event_type] = num(r.c);

    const emailByType: Record<string, number> = {};
    for (const r of emailRows) emailByType[r.event_type] = num(r.c);
    const delivered = num(emailByType.delivered);
    const opens = num(emailByType.open);
    const clicks = num(emailByType.click);

    res.json({
      data: {
        window_days: days,
        funnel,
        email: {
          by_type: emailByType,
          open_rate: ratio(opens, delivered),
          click_to_open_rate: ratio(clicks, opens),
        },
        behavioral_active_users: num(active?.c),
      },
    });
  } catch (error) {
    next(error);
  }
}
