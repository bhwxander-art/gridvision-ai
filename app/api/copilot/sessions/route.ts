import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { getServerClient, isDbConfigured } from "@/lib/db/client";
import { ChatSessionRepository } from "@/lib/db/repositories/chat-session.repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ sessions: [], count: 0 });
  }

  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const repo = new ChatSessionRepository(getServerClient());
    const sessions = await repo.listSessions(ctx.tenantId, 20);
    return Response.json({ sessions, count: sessions.length });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ error: "Database not configured" }, { status: 503 });
  }

  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let title: string | undefined;
  try {
    const body = await req.json().catch(() => ({})) as { title?: string };
    title = body.title;
  } catch {
    title = undefined;
  }

  try {
    const repo = new ChatSessionRepository(getServerClient());
    const session = await repo.createSession(ctx.tenantId, ctx.userId, title);
    return Response.json(session, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
