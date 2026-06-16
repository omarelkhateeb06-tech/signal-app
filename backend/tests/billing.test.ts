// Phase 12h — billing controller unit tests.

import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
}));

// -------------------------------------------------------------------------
// Stripe mock — defined inside factory so it's available at hoist time
// -------------------------------------------------------------------------
jest.mock("../src/lib/stripe", () => {
  const checkoutCreate = jest.fn();
  const portalCreate = jest.fn();
  const webhooksConstruct = jest.fn();
  return {
    stripe: {
      checkout: { sessions: { create: checkoutCreate } },
      billingPortal: { sessions: { create: portalCreate } },
      webhooks: { constructEvent: webhooksConstruct },
    },
    __checkoutCreate: checkoutCreate,
    __portalCreate: portalCreate,
    __webhooksConstruct: webhooksConstruct,
  };
});

import {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
} from "../src/controllers/billingController";
import { AppError } from "../src/middleware/errorHandler";

const stripeMock = jest.requireMock("../src/lib/stripe") as {
  __checkoutCreate: jest.Mock;
  __portalCreate: jest.Mock;
  __webhooksConstruct: jest.Mock;
};

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function makeReq(overrides: Record<string, unknown> = {}): never {
  return {
    user: { userId: "user-123" },
    body: {},
    headers: {},
    ...overrides,
  } as never;
}

const next = jest.fn();

function makeRes() {
  return { json: jest.fn(), status: jest.fn() };
}

beforeEach(() => {
  mock.reset();
  jest.clearAllMocks();
  process.env.STRIPE_PRICE_ID = "price_test_monthly";
  process.env.FRONTEND_URL = "http://localhost:3000";
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

// -------------------------------------------------------------------------
// createCheckoutSession
// -------------------------------------------------------------------------
describe("createCheckoutSession", () => {
  it("creates a checkout session and returns the URL", async () => {
    mock.queueSelect([
      { email: "test@example.com", stripeCustomerId: null, stripeSubscriptionId: null },
    ]);
    stripeMock.__checkoutCreate.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/test",
    });

    const res = makeRes();
    await createCheckoutSession(makeReq({ body: { plan: "monthly" } }), res as never, next);

    expect(res.json).toHaveBeenCalledWith({
      data: { url: "https://checkout.stripe.com/test" },
    });
    expect(stripeMock.__checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer_email: "test@example.com",
        subscription_data: { trial_period_days: 7 },
      }),
    );
  });

  it("re-uses existing customer and omits trial for returning subscriber", async () => {
    mock.queueSelect([
      {
        email: "test@example.com",
        stripeCustomerId: "cus_old",
        stripeSubscriptionId: "sub_old",
      },
    ]);
    stripeMock.__checkoutCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/2" });

    const res = makeRes();
    await createCheckoutSession(makeReq({ body: { plan: "monthly" } }), res as never, next);

    expect(stripeMock.__checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_old" }),
    );
    const callArg = stripeMock.__checkoutCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.subscription_data).toBeUndefined();
  });

  it("returns 401 when userId is absent", async () => {
    const res = makeRes();
    await createCheckoutSession(makeReq({ user: undefined }), res as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).status).toBe(401);
  });

  it("returns 503 when STRIPE_PRICE_ID is unset", async () => {
    delete process.env.STRIPE_PRICE_ID;
    mock.queueSelect([
      { email: "x@x.com", stripeCustomerId: null, stripeSubscriptionId: null },
    ]);

    const res = makeRes();
    await createCheckoutSession(makeReq({ body: { plan: "monthly" } }), res as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).status).toBe(503);
  });
});

// -------------------------------------------------------------------------
// handleWebhook
// -------------------------------------------------------------------------
describe("handleWebhook", () => {
  it("returns {received:true} immediately when webhook secret is unset", async () => {
    const res = makeRes();
    await handleWebhook(
      makeReq({ body: Buffer.from("{}"), headers: { "stripe-signature": "sig" } }),
      res as never,
      next,
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(stripeMock.__webhooksConstruct).not.toHaveBeenCalled();
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

    const res = makeRes();
    await handleWebhook(makeReq({ body: Buffer.from("{}"), headers: {} }), res as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).status).toBe(400);
  });

  it("returns 400 when Stripe signature verification fails", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeMock.__webhooksConstruct.mockImplementationOnce(() => {
      throw new Error("Signature mismatch");
    });

    const res = makeRes();
    await handleWebhook(
      makeReq({ body: Buffer.from("{}"), headers: { "stripe-signature": "bad" } }),
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).status).toBe(400);
  });

  it("flips tier to pro on checkout.session.completed", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeMock.__webhooksConstruct.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { user_id: "user-123" },
          customer: "cus_new",
          subscription: "sub_new",
        },
      },
    });

    const res = makeRes();
    await handleWebhook(
      makeReq({ body: Buffer.from("{}"), headers: { "stripe-signature": "sig" } }),
      res as never,
      next,
    );

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mock.state.updatedRows).toHaveLength(1);
    expect(mock.state.updatedRows[0]).toMatchObject({
      tier: "pro",
      stripeCustomerId: "cus_new",
      stripeSubscriptionId: "sub_new",
    });
  });
});

// -------------------------------------------------------------------------
// createPortalSession
// -------------------------------------------------------------------------
describe("createPortalSession", () => {
  it("opens portal and returns URL", async () => {
    mock.queueSelect([{ stripeCustomerId: "cus_abc" }]);
    stripeMock.__portalCreate.mockResolvedValueOnce({
      url: "https://billing.stripe.com/portal",
    });

    const res = makeRes();
    await createPortalSession(makeReq(), res as never, next);

    expect(res.json).toHaveBeenCalledWith({
      data: { url: "https://billing.stripe.com/portal" },
    });
    expect(stripeMock.__portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_abc",
        return_url: "http://localhost:3000/settings",
      }),
    );
  });

  it("returns 404 when user has no stripe customer", async () => {
    mock.queueSelect([{ stripeCustomerId: null }]);

    const res = makeRes();
    await createPortalSession(makeReq(), res as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).status).toBe(404);
  });
});
