import "server-only";
import crypto from "crypto";

/**
 * Stripe Configuration for Production Billing
 * Real webhook verification and security measures
 */

const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!stripeKey && process.env.NODE_ENV === "production") {
  throw new Error("STRIPE_SECRET_KEY is required in production");
}

// Stripe client - import real SDK when available
// Stub for now but structured for real SDK replacement
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
} as any;

export const STRIPE_CONFIG = {
  publishableKey,
  secretKey: stripeKey,
  webhookSecret,
  isConfigured: Boolean(stripeKey && publishableKey),
};

// Webhook signature verification
export function verifyWebhookSignature(body: string | Buffer, signature: string): {
  id: string;
  type: string;
  data: any;
  created: number;
} {
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }

  // Parse signature header
  const signatureComponents = (signature || "").split(",");
  let timestamp: string | null = null;
  let signedContent: string | null = null;

  for (const component of signatureComponents) {
    const [key, value] = component.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signedContent = value;
  }

  if (!timestamp || !signedContent) {
    throw new Error("Invalid Stripe signature format");
  }

  // Prevent replay attacks - check timestamp is recent (within 5 minutes)
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDifference = Math.abs(currentTime - requestTime);

  if (timeDifference > 300) { // 5 minutes
    throw new Error("Webhook timestamp too old - possible replay attack");
  }

  // Verify signature
  const bodyString = typeof body === "string" ? body : body.toString("utf8");
  const signedData = `${timestamp}.${bodyString}`;

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedData)
    .digest("hex");

  if (signedContent !== expectedSignature) {
    throw new Error("Invalid Stripe webhook signature");
  }

  try {
    return JSON.parse(bodyString);
  } catch {
    throw new Error("Invalid JSON in webhook body");
  }
}

// Idempotency tracking (in-memory for now, should use Redis in production)
const processedEvents = new Set<string>();

export function isWebhookProcessed(eventId: string): boolean {
  return processedEvents.has(eventId);
}

export function markWebhookProcessed(eventId: string): void {
  processedEvents.add(eventId);
  // In production, also store in Redis with TTL of 24 hours
}

/**
 * Stripe Product and Price IDs
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

export async function getStripeSubscription(subscriptionId: string): Promise<any> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

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
