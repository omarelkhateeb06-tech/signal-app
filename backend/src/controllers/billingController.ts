import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { stripe } from "../lib/stripe";

// Phase 12h — Stripe billing.
//
// Three handlers share this file:
//   createCheckoutSession — POST /api/v1/billing/checkout
//   handleWebhook         — POST /api/v1/billing/webhook  (raw body, no JWT)
//   createPortalSession   — POST /api/v1/billing/portal

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function requireStripe() {
  if (!stripe) {
    throw new AppError("BILLING_UNAVAILABLE", "Billing is not configured.", 503);
  }
  return stripe;
}

const MONTHLY_PRICE_ID = process.env.STRIPE_PRICE_ID;
const ANNUAL_PRICE_ID = process.env.STRIPE_ANNUAL_PRICE_ID ?? process.env.STRIPE_PRICE_ID;

const checkoutBodySchema = z.object({
  plan: z.enum(["monthly", "annual"]).default("monthly"),
});

// -------------------------------------------------------------------------
// POST /api/v1/billing/checkout
// -------------------------------------------------------------------------
export async function createCheckoutSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const client = requireStripe();
    const userId = req.user?.userId;
    if (!userId) throw new AppError("UNAUTHORIZED", "Not authenticated", 401);

    const { plan } = checkoutBodySchema.parse(req.body);

    const priceId = plan === "annual" ? ANNUAL_PRICE_ID : MONTHLY_PRICE_ID;
    if (!priceId) {
      throw new AppError(
        "BILLING_UNAVAILABLE",
        "Billing price is not configured.",
        503,
      );
    }

    const [user] = await db
      .select({
        email: users.email,
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

    // Re-use an existing Stripe customer to avoid duplicates.
    const customerParam: { customer: string } | { customer_email: string } =
      user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email };

    const session = await client.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/upgrade`,
      metadata: { user_id: userId },
      ...customerParam,
      // 7-day trial for first-time subscribers (no existing subscription).
      ...(!user.stripeSubscriptionId
        ? { subscription_data: { trial_period_days: 7 } }
        : {}),
    });

    res.json({ data: { url: session.url } });
  } catch (e) {
    next(e);
  }
}

// -------------------------------------------------------------------------
// POST /api/v1/billing/webhook  — raw body, no JWT, Stripe signature required
// -------------------------------------------------------------------------
export async function handleWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const client = requireStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      // Webhook secret not yet wired — return 200 so Stripe doesn't retry
      // during initial deploy before the secret is set.
      res.json({ received: true });
      return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      throw new AppError("INVALID_BODY", "Missing stripe-signature header", 400);
    }

    let event: import("stripe").Stripe.Event;
    try {
      event = client.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch {
      throw new AppError("INVALID_BODY", "Webhook signature verification failed", 400);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        if (userId && session.customer && session.subscription) {
          await db
            .update(users)
            .set({
              tier: "pro",
              tierChangedAt: new Date(),
              stripeCustomerId: session.customer as string,
              stripeSubscriptionId: session.subscription as string,
            })
            .where(eq(users.id, userId));
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        // Find user by subscription ID and downgrade to free.
        await db
          .update(users)
          .set({
            tier: "free",
            tierChangedAt: new Date(),
            stripeSubscriptionId: null,
          })
          .where(eq(users.stripeSubscriptionId, sub.id));
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        // Handle paused / unpaid subscriptions — downgrade to free. Active
        // stays as-is (the tier flip already happened on checkout.session.completed).
        if (sub.status === "paused" || sub.status === "unpaid" || sub.status === "past_due") {
          await db
            .update(users)
            .set({ tier: "free", tierChangedAt: new Date() })
            .where(eq(users.stripeSubscriptionId, sub.id));
        } else if (sub.status === "active") {
          await db
            .update(users)
            .set({ tier: "pro", tierChangedAt: new Date() })
            .where(eq(users.stripeSubscriptionId, sub.id));
        }
        break;
      }

      default:
        // Unhandled event types — log and acknowledge.
        break;
    }

    res.json({ received: true });
  } catch (e) {
    next(e);
  }
}

// -------------------------------------------------------------------------
// POST /api/v1/billing/portal
// -------------------------------------------------------------------------
export async function createPortalSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const client = requireStripe();
    const userId = req.user?.userId;
    if (!userId) throw new AppError("UNAUTHORIZED", "Not authenticated", 401);

    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.stripeCustomerId) {
      throw new AppError(
        "BILLING_NOT_FOUND",
        "No billing account found. Subscribe first.",
        404,
      );
    }

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const session = await client.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${frontendUrl}/settings`,
    });

    res.json({ data: { url: session.url } });
  } catch (e) {
    next(e);
  }
}
