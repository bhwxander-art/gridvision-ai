import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { ScenarioRepository, type SavedScenario } from "@/lib/db/repositories/scenario.repository";
import { getAuthServerClient } from "@/lib/auth/server";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { SaveScenarioSchema, validationError } from "@/lib/validation";
import { getRateLimitKey, checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

async function getCurrentUserId(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    const auth = await getAuthServerClient();
    const { data: { user } } = await auth.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse<SavedScenario[] | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    const userId = await getCurrentUserId();
    const ctx = await getCurrentTenant();
    const repo = new ScenarioRepository(getServerClient());
    const scenarios = await repo.findAll(userId, ctx?.tenantId);
    return NextResponse.json(scenarios);
  } catch (err) {
    console.error("[api/scenarios GET]", err);
    return NextResponse.json({ error: "Failed to load scenarios" }, { status: 500 });
  }
}

export async function POST(
  req: Request
): Promise<NextResponse<SavedScenario | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SaveScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues);
  }

  const { name, inputs } = parsed.data;

  const userId = await getCurrentUserId();
  const ctx = await getCurrentTenant();
  if (!checkRateLimit(getRateLimitKey(userId, req))) {
    return rateLimitResponse();
  }

  try {
    const repo = new ScenarioRepository(getServerClient());
    const saved = await repo.save({
      user_id: userId,
      tenant_id: ctx?.tenantId ?? null,
      name,
      inputs,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    console.error("[api/scenarios POST]", err);
    return NextResponse.json({ error: "Failed to save scenario" }, { status: 500 });
  }
}
