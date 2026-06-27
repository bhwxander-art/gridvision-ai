import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { getServerClient, isDbConfigured } from "@/lib/db/client";
import { ChatSessionRepository } from "@/lib/db/repositories/chat-session.repository";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ error: "Database not configured" }, { status: 503 });
  }

  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const repo = new ChatSessionRepository(getServerClient());
    const session = await repo.getSession(id, ctx.tenantId);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const messages = await repo.getMessages(id, ctx.tenantId);
    return Response.json({ session, messages });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ error: "Database not configured" }, { status: 503 });
  }

  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let title: string;
  try {
    const body = await req.json() as { title?: string };
    if (!body.title || typeof body.title !== "string") {
      return Response.json({ error: "title is required" }, { status: 400 });
    }
    title = body.title.trim();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const repo = new ChatSessionRepository(getServerClient());
    await repo.renameSession(id, ctx.tenantId, title);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ error: "Database not configured" }, { status: 503 });
  }

  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const repo = new ChatSessionRepository(getServerClient());
    await repo.deleteSession(id, ctx.tenantId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
