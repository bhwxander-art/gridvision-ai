/**
 * LODF matrix persistence — INFRA-010
 *
 * Stores the computed LODF matrix in Supabase Storage (bucket: "lodf-cache")
 * as a compact binary blob at path {tenantId}/{modelId}.lodf
 *
 * Binary layout (mirrors lib/ptdf/ptdf-storage.ts):
 *   [0..3]    magic "LODF" (4 ASCII bytes)
 *   [4..7]    version = 1 (uint32 LE)
 *   [8..11]   size (uint32 LE) — e, shared row/col count
 *   [12..19]  computedAt (float64 LE, ms since epoch)
 *   [20..23]  modelId byte length (uint32 LE)
 *   [24..23+M] modelId UTF-8 bytes
 *   [24+M..27+M]  topologyHash byte length (uint32 LE, 0 = absent)
 *   [28+M..27+M+H] topologyHash UTF-8 bytes
 *   then: size × 4 bytes (branchNumbers Uint32)
 *   then: islandingCount (uint32 LE)
 *   then: islandingCount × 4 bytes (islanding branch numbers, Uint32)
 *   then: size × size × 8 bytes (Float64 LODF data, row-major; NaN preserved
 *         bit-for-bit through DataView — islanding columns round-trip exactly)
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LodfMatrix, LodfStorageAdapter } from "./types";

const BUCKET = "lodf-cache";
const MAGIC = 0x46444f4c; // "LODF" as uint32 (LE byte order matches "LODF" ASCII)

function storagePath(tenantId: string, modelId: string): string {
  return `${tenantId}/${modelId}.lodf`;
}

// ── Serialisation ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

export function serialiseLodf(matrix: LodfMatrix): Uint8Array {
  const modelIdBytes = enc.encode(matrix.modelId);
  const hashBytes = matrix.topologyHash ? enc.encode(matrix.topologyHash) : new Uint8Array(0);
  const M = modelIdBytes.length;
  const H = hashBytes.length;
  const size = matrix.size;
  const islandCount = matrix.islandingBranches.length;

  const headerSize = 4 + 4 + 4 + 8 + 4 + M + 4 + H;
  const branchIndexSize = size * 4;
  const islandingSize = 4 + islandCount * 4;
  const dataSize = size * size * 8;
  const totalSize = headerSize + branchIndexSize + islandingSize + dataSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  let off = 0;

  view.setUint32(off, MAGIC, true); off += 4;
  view.setUint32(off, 1, true); off += 4;
  view.setUint32(off, size, true); off += 4;
  view.setFloat64(off, Date.parse(matrix.computedAt), true); off += 8;

  view.setUint32(off, M, true); off += 4;
  new Uint8Array(buf).set(modelIdBytes, off); off += M;

  view.setUint32(off, H, true); off += 4;
  if (H > 0) { new Uint8Array(buf).set(hashBytes, off); off += H; }

  for (let i = 0; i < size; i++) {
    view.setUint32(off, matrix.branchNumbers[i], true); off += 4;
  }

  view.setUint32(off, islandCount, true); off += 4;
  for (let i = 0; i < islandCount; i++) {
    view.setUint32(off, matrix.islandingBranches[i], true); off += 4;
  }

  for (let i = 0; i < size * size; i++) {
    view.setFloat64(off, matrix.data[i], true); off += 8;
  }

  return new Uint8Array(buf);
}

export function deserialiseLodf(bytes: Uint8Array): LodfMatrix {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;

  const magic = view.getUint32(off, true); off += 4;
  if (magic !== MAGIC) throw new Error("[LodfStorage] Invalid magic bytes — not a LODF file");

  const version = view.getUint32(off, true); off += 4;
  if (version !== 1) throw new Error(`[LodfStorage] Unsupported version ${version}`);

  const size = view.getUint32(off, true); off += 4;
  const tsMs = view.getFloat64(off, true); off += 8;
  const computedAt = new Date(tsMs).toISOString();

  const M = view.getUint32(off, true); off += 4;
  const modelId = dec.decode(bytes.subarray(off, off + M)); off += M;

  const H = view.getUint32(off, true); off += 4;
  const topologyHash = H > 0 ? dec.decode(bytes.subarray(off, off + H)) : null; off += H;

  const branchNumbers: number[] = [];
  for (let i = 0; i < size; i++) {
    branchNumbers.push(view.getUint32(off, true)); off += 4;
  }

  const islandCount = view.getUint32(off, true); off += 4;
  const islandingBranches: number[] = [];
  for (let i = 0; i < islandCount; i++) {
    islandingBranches.push(view.getUint32(off, true)); off += 4;
  }

  const data = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    data[i] = view.getFloat64(off, true); off += 8;
  }

  return {
    modelId,
    branchNumbers,
    data,
    size,
    islandingBranches,
    computedAt,
    topologyHash,
  };
}

// ── Supabase Storage adapter ──────────────────────────────────────────────────

export class SupabaseLodfStorage implements LodfStorageAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async load(tenantId: string, modelId: string): Promise<LodfMatrix | null> {
    const path = storagePath(tenantId, modelId);
    const { data, error } = await this.client.storage
      .from(BUCKET)
      .download(path);

    if (error) {
      // Object not found is not an error — just a cache miss
      if (
        error.message?.includes("not found") ||
        error.message?.includes("404") ||
        error.message?.includes("Object not found")
      ) {
        return null;
      }
      throw new Error(`[LodfStorage.load] ${error.message}`);
    }
    if (!data) return null;

    const bytes = new Uint8Array(await data.arrayBuffer());
    return deserialiseLodf(bytes);
  }

  async store(tenantId: string, matrix: LodfMatrix): Promise<void> {
    const path = storagePath(tenantId, matrix.modelId);
    const bytes = serialiseLodf(matrix);
    const blob = new Blob([bytes], { type: "application/octet-stream" });

    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(path, blob, { upsert: true });

    if (error) {
      throw new Error(`[LodfStorage.store] ${error.message}`);
    }
  }

  async invalidate(tenantId: string, modelId: string): Promise<void> {
    const path = storagePath(tenantId, modelId);
    const { error } = await this.client.storage
      .from(BUCKET)
      .remove([path]);

    // Tolerate "not found" — already invalidated
    if (error && !error.message?.includes("not found") && !error.message?.includes("404")) {
      throw new Error(`[LodfStorage.invalidate] ${error.message}`);
    }
  }
}

// ── In-memory adapter (for testing) ──────────────────────────────────────────

export class InMemoryLodfStorage implements LodfStorageAdapter {
  private readonly cache = new Map<string, LodfMatrix>();

  private cacheKey(tenantId: string, modelId: string): string {
    return `${tenantId}/${modelId}`;
  }

  async load(tenantId: string, modelId: string): Promise<LodfMatrix | null> {
    return this.cache.get(this.cacheKey(tenantId, modelId)) ?? null;
  }

  async store(tenantId: string, matrix: LodfMatrix): Promise<void> {
    this.cache.set(this.cacheKey(tenantId, matrix.modelId), matrix);
  }

  async invalidate(tenantId: string, modelId: string): Promise<void> {
    this.cache.delete(this.cacheKey(tenantId, modelId));
  }
}
