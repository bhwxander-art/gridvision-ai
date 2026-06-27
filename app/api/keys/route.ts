import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { getServerClient, isDbConfigured } from "@/lib/db/client";
import { ApiKeyRepository } from "@/lib/db/repositories/api-key.repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ keys: [], count: 0 });
  }

  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const repo = new ApiKeyRepository(getServerClient());
    const keys = await repo.listKeys(ctx.tenantId);
    // Never return key_hash to the client
    const safeKeys = keys.map(({ key_hash: _hash, ...rest }) => rest);
    return Response.json({ keys: safeKeys, count: safeKeys.length });
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

  let name: string;
  let scopes: string[];
  let expiresAt: Date | undefined;
  try {
    const body = await req.json() as {
      name?: string;
      scopes?: string[];
      expiresAt?: string;
    };

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    name = body.name.trim();

    const validScopes = ["read", "write", "admin"];
    scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((s): s is string => validScopes.includes(s))
      : ["read"];

    if (scopes.length === 0) {
      return Response.json({ error: "At least one valid scope is required" }, { status: 400 });
    }

    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (isNaN(d.getTime())) {
        return Response.json({ error: "Invalid expiresAt date" }, { status: 400 });
      }
      expiresAt = d;
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const repo = new ApiKeyRepository(getServerClient());
    const { key, record } = await repo.createKey(ctx.tenantId, name, scopes, expiresAt);
    const { key_hash: _hash, ...safeRecord } = record;
    return Response.json({ key, record: safeRecord }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
