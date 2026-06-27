import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { isDbConfigured } from "@/lib/db/client";
import { dispatchNotification } from "@/lib/notifications/dispatcher";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let channel: "email" | "slack" | "teams";
  try {
    const body = await req.json() as { channel?: string };
    if (!body.channel || !["email", "slack", "teams"].includes(body.channel)) {
      return Response.json(
        { error: "channel must be one of: email, slack, teams" },
        { status: 400 }
      );
    }
    channel = body.channel as "email" | "slack" | "teams";
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isDbConfigured()) {
    return Response.json(
      { ok: false, error: "Database not configured — cannot read notification settings" },
      { status: 503 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://gridvision.ai";

  // Dispatch a test notification via the requested channel
  // We use health_alert with info severity so it doesn't look alarming
  try {
    await dispatchNotification({
      tenantId: ctx.tenantId,
      eventType: "health_alert",
      headline: "GridVision AI — Test Notification",
      body: `This is a test notification from GridVision AI sent via ${channel}. Your notification channel is configured correctly.`,
      severity: "info",
      appUrl: `${appUrl}/enterprise`,
    });

    return Response.json({ ok: true, channel });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
