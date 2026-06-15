import Stripe from "stripe";

// Stripe client singleton. Null when STRIPE_SECRET_KEY is unset (local dev
// without billing). Controllers check for null and throw BILLING_UNAVAILABLE.
//
// apiVersion: pin to the version the SDK ships with. If type-check rejects
// this string, run `npm info stripe` and look for `types.apiVersion` in the
// package metadata, then update here.
const STRIPE_API_VERSION = "2024-06-20" satisfies Stripe.LatestApiVersion;

export const stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
    })
  : null;
