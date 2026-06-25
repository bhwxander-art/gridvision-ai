import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant, requireTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getSubscription,
  upgradeSubscription,
  cancelSubscription,
  recordBillingEvent,
} from "@/lib/services/subscription.service";
import { handleDatabaseError, handleValidationError } from "@/lib/utils/safe-error";
import { logAuditEvent } from "@/lib/db/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

// ── GET /api/billing/subscriptions ──────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ subscription: null }, { status: 200 });
  }

  try {
    const client = getServerClient();
    const subscription = await getSubscription(client, ctx.tenantId);

    return NextResponse.json(
      { subscription },
      {
        headers: {
          "Cache-Control": "max-age=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/billing/subscriptions");
    return NextResponse.json(safe, { status: 500 });
  }
}

// ── PATCH /api/billing/subscriptions ────────────────────────────────────────────

const SubscriptionUpdateSchema = z.object({
  action: z.enum(["upgrade", "downgrade", "cancel"]),
  planTier: z.enum(["starter", "professional", "enterprise"]).optional(),
  immediate: z.boolean().optional(),
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireTenant();

  if (!hasPermission(ctx.role, "settings:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = SubscriptionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      ),
      { status: 422 }
    );
  }

  try {
    const client = getServerClient();
    const subscription = await getSubscription(client, ctx.tenantId);

    if (!subscription) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    let updatedSubscription;

    switch (parsed.data.action) {
      case "upgrade": {
        if (!parsed.data.planTier) {
          return NextResponse.json(
            { error: "planTier required for upgrade" },
            { status: 400 }
          );
        }

        updatedSubscription = await upgradeSubscription(
          client,
          subscription.id,
          parsed.data.planTier
        );

        // Log event
        await recordBillingEvent(client, ctx.tenantId, "subscription_upgraded", {
          from: subscription.plan_tier,
          to: parsed.data.planTier,
        });

        await logAuditEvent(client, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action: "subscription_update",
          resourceType: "subscription",
          resourceId: subscription.id,
          changes: { action: "upgrade", newPlan: parsed.data.planTier },
        });

        break;
      }

      case "downgrade": {
        if (!parsed.data.planTier) {
          return NextResponse.json(
            { error: "planTier required for downgrade" },
            { status: 400 }
          );
        }

        updatedSubscription = await upgradeSubscription(
          client,
          subscription.id,
          parsed.data.planTier
        );

        // Log event
        await recordBillingEvent(client, ctx.tenantId, "subscription_downgraded", {
          from: subscription.plan_tier,
          to: parsed.data.planTier,
        });

        break;
      }

      case "cancel": {
        updatedSubscription = await cancelSubscription(
          client,
          subscription.id,
          parsed.data.immediate ?? false
        );

        // Log event
        await recordBillingEvent(client, ctx.tenantId, "subscription_cancelled", {
          plan: subscription.plan_tier,
          immediate: parsed.data.immediate ?? false,
        });

        break;
      }
    }

    return NextResponse.json({ subscription: updatedSubscription });
  } catch (err) {
    const safe = handleDatabaseError(err, "PATCH /api/billing/subscriptions");
    return NextResponse.json(safe, { status: 500 });
  }
}
