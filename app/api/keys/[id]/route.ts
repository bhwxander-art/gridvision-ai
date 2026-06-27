import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { getServerClient, isDbConfigured } from "@/lib/db/client";
import { ApiKeyRepository } from "@/lib/db/repositories/api-key.repository";

export const dynamic = "force-dynamic";

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
    const repo = new ApiKeyRepository(getServerClient());
    await repo.revokeKey(id, ctx.tenantId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
