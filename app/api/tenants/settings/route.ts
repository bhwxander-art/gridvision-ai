import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant, requireTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import { logAuditEvent } from "@/lib/db/audit";
import { handleDatabaseError, handleValidationError } from "@/lib/utils/safe-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SettingsSchema = z.object({
  companyName: z.string().min(1).max(255).optional(),
  logoUrl: z.string().url().optional(),
  timezone: z.string().optional(),
  defaultUnits: z.enum(["metric", "imperial"]).optional(),
  notificationEmail: z.string().email().optional(),
  notificationPreferences: z.object({
    emailOnDataStale: z.boolean().optional(),
    emailOnProjectUpdate: z.boolean().optional(),
    emailOnAccountUpdate: z.boolean().optional(),
    slackWebhookUrl: z.string().url().optional(),
  }).optional(),
});

export interface TenantSettingsResponse {
  tenantId: string;
  settings: Record<string, unknown>;
}

export async function GET(): Promise<NextResponse<TenantSettingsResponse | { error: string }>> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(ctx.role, "settings:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({
      tenantId: ctx.tenantId,
      settings: {},
    });
  }

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("tenants")
      .select("settings")
      .eq("id", ctx.tenantId)
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      tenantId: ctx.tenantId,
      settings: data?.settings ?? {},
    });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/tenants/settings");
    return NextResponse.json(safe, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse<TenantSettingsResponse | { error: string }>> {
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

  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>),
      { status: 422 }
    );
  }

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("tenants")
      .select("settings")
      .eq("id", ctx.tenantId)
      .single();

    if (error) throw new Error(error.message);

    const currentSettings = data?.settings ?? {};
    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined)
    );
    const updatedSettings = {
      ...currentSettings,
      ...updates,
    };

    const { error: updateError } = await client
      .from("tenants")
      .update({ settings: updatedSettings })
      .eq("id", ctx.tenantId);

    if (updateError) throw new Error(updateError.message);

    // Log audit event
    await logAuditEvent(client, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "settings_update",
      resourceType: "settings",
      resourceId: ctx.tenantId,
      changes: updates,
    });

    return NextResponse.json({
      tenantId: ctx.tenantId,
      settings: updatedSettings,
    });
  } catch (err) {
    const safe = handleDatabaseError(err, "PATCH /api/tenants/settings");
    return NextResponse.json(safe, { status: 500 });
  }
}
