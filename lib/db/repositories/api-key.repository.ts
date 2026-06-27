import "server-only";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbApiKey } from "@/lib/db/types";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export class ApiKeyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listKeys(tenantId: string): Promise<DbApiKey[]> {
    const { data, error } = await this.client
      .from("api_keys")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`[ApiKeyRepository.listKeys] ${error.message}`);
    return (data ?? []) as DbApiKey[];
  }

  /** Generates a new key. Returns the PLAIN key (shown once) and the DB record. */
  async createKey(
    tenantId: string,
    name: string,
    scopes: string[],
    expiresAt?: Date
  ): Promise<{ key: string; record: DbApiKey }> {
    const rawKey = `gv_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 10);

    const { data, error } = await this.client
      .from("api_keys")
      .insert({
        tenant_id: tenantId,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes,
        expires_at: expiresAt?.toISOString() ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`[ApiKeyRepository.createKey] ${error.message}`);
    return { key: rawKey, record: data as DbApiKey };
  }

  async revokeKey(id: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`[ApiKeyRepository.revokeKey] ${error.message}`);
  }

  async validateKey(rawKey: string): Promise<DbApiKey | null> {
    const keyHash = hashKey(rawKey);
    const { data, error } = await this.client
      .from("api_keys")
      .select("*")
      .eq("key_hash", keyHash)
      .is("revoked_at", null)
      .single();
    if (error || !data) return null;

    const key = data as DbApiKey;

    // Check expiry
    if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

    // Best-effort: update last_used and increment count
    await this.client
      .from("api_keys")
      .update({
        last_used_at: new Date().toISOString(),
        request_count: key.request_count + 1,
      })
      .eq("id", key.id)
      .then(() => {});

    return key;
  }
}
