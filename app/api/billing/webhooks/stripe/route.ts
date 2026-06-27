import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db/client";
import {
  verifyWebhookSignature,
  isWebhookProcessed,
  markWebhookProcessed,
} from "@/lib/integrations/stripe-config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  try {
    const signature = req.headers.get("stripe-signature") || "";
    const body = await req.text();

    // Verify webhook signature (prevents replay attacks + signature tampering)
    let event;
    try {
      event = verifyWebhookSignature(body, signature);
    } catch (err) {
      console.error("[Stripe Webhook] Signature verification failed:", err);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Check for replay attacks - idempotency check
    if (isWebhookProcessed(event.id)) {
      console.warn(`[Stripe Webhook] Duplicate event (idempotent): ${event.id}`);
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Mark as processed (prevents duplicate charges)
    markWebhookProcessed(event.id);

    // Handle webhook events
    const subscription = event.data?.object as Record<string, unknown> & {
      id?: string;
      status?: string;
      metadata?: Record<string, string>;
      subscription?: string;
      amount_paid?: number;
    };
    const tenantId = subscription?.metadata?.tenantId;

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        if (subscription?.id) {
          console.log(`[Stripe] Subscription ${event.type}: ${subscription.id}`, {
            tenantId,
            status: subscription.status,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        if (subscription?.id) {
          console.log(`[Stripe] Subscription deleted: ${subscription.id}`, { tenantId });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice?.subscription) {
          console.error(`[Stripe] Payment failed for subscription: ${invoice.subscription}`);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        if (invoice?.subscription) {
          console.log(`[Stripe] Payment succeeded for subscription: ${invoice.subscription}`, {
            amount: invoice.amount_paid,
          });
        }
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("[Stripe Webhook] Error processing webhook:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
