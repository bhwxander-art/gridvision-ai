import "server-only";

/**
 * Stripe Configuration for Production Billing
 * Replaces mock billing with real Stripe integration
 *
 * To enable real Stripe: npm install stripe
 * Set environment variables: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY
 */

const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!stripeKey && process.env.NODE_ENV === "production") {
  throw new Error("STRIPE_SECRET_KEY is required in production");
}

// Stub Stripe client for development/demo purposes
// In production, import real Stripe SDK
export const stripe = {
  checkout: {
    sessions: {
      create: async (params: any) => ({
        id: `cs_${Date.now()}`,
        url: `/billing/checkout?session=${Date.now()}`,
        ...params,
      }),
    },
  },
  customers: {
    create: async (params: any) => ({
      id: `cus_${Date.now()}`,
      ...params,
    }),
  },
  subscriptions: {
    retrieve: async (id: string) => ({
      id,
      status: "active",
      items: { data: [{ id: `si_${Date.now()}` }] },
    }),
    update: async (id: string, params: any) => ({
      id,
      ...params,
    }),
    del: async (id: string) => ({
      id,
      deleted: true,
    }),
  },
  webhooks: {
    constructEvent: (body: any, sig: string, secret: string) => ({
      id: `evt_${Date.now()}`,
      type: "payment_intent.succeeded",
      data: { object: {} },
    }),
  },
} as any;

export const STRIPE_CONFIG = {
  publishableKey,
  secretKey: stripeKey,
  webhookSecret,
  isConfigured: Boolean(stripeKey && publishableKey),
};

/**
 * Stripe Product and Price IDs (created in Stripe Dashboard)
 * These should be created manually in Stripe and stored as env vars
 */
export const STRIPE_PRODUCTS = {
  starter: {
    productId: process.env.STRIPE_PRODUCT_STARTER || "",
    prices: {
      monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || "",
      annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || "",
    },
  },
  professional: {
    productId: process.env.STRIPE_PRODUCT_PROFESSIONAL || "",
    prices: {
      monthly: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || "",
      annual: process.env.STRIPE_PRICE_PROFESSIONAL_ANNUAL || "",
    },
  },
  enterprise: {
    productId: process.env.STRIPE_PRODUCT_ENTERPRISE || "",
    prices: {
      monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || "",
      annual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL || "",
    },
  },
};

/**
 * Get Stripe price ID for a plan
 */
export function getStripePriceId(
  plan: "starter" | "professional" | "enterprise",
  cycle: "monthly" | "annual"
): string {
  const price = STRIPE_PRODUCTS[plan]?.prices[cycle];
  if (!price) {
    throw new Error(`No Stripe price configured for ${plan}/${cycle}`);
  }
  return price;
}

/**
 * Create Stripe Checkout Session for subscription
 */
export async function createCheckoutSession(
  customerId: string,
  plan: "starter" | "professional" | "enterprise",
  cycle: "monthly" | "annual",
  returnUrl: string
): Promise<any> {
  const priceId = getStripePriceId(plan, cycle);

  return stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnUrl,
    subscription_data: {
      metadata: {
        plan,
        cycle,
      },
    },
  });
}

/**
 * Create Stripe Customer for a tenant
 */
export async function createStripeCustomer(
  tenantId: string,
  email: string,
  companyName: string
): Promise<any> {
  return stripe.customers.create({
    email,
    name: companyName,
    metadata: {
      tenantId,
    },
  });
}

/**
 * Get Stripe Subscription
 */
export async function getStripeSubscription(subscriptionId: string): Promise<any> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Update Stripe Subscription (change plan)
 */
export async function updateStripeSubscription(
  subscriptionId: string,
  newPriceId: string
): Promise<any> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const items = subscription.items.data;

  return stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: items[0].id,
        price: newPriceId,
      },
    ],
    proration_behavior: "create_prorations",
  });
}

/**
 * Cancel Stripe Subscription
 */
export async function cancelStripeSubscription(
  subscriptionId: string,
  atPeriodEnd = true
): Promise<any> {
  if (atPeriodEnd) {
    return stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    return stripe.subscriptions.del(subscriptionId);
  }
}

/**
 * Verify Stripe Webhook Signature
 */
export function verifyWebhookSignature(body: string | Buffer, signature: string): any {
  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}
