/**
 * PTDF matrix persistence — INFRA-009
 *
 * Stores the computed PTDF matrix in Supabase Storage (bucket: "ptdf-cache")
 * as a compact binary blob at path {tenantId}/{modelId}.ptdf
 *
 * This replaces the HDF5 requirement from the INFRA-009 spec: the Vercel/
 * Supabase deployment stack does not support native HDF5 I/O.  The binary
 * format is semantically equivalent:
 *   • Fixed-width header (40 bytes)
 *   • UTF-8 strings for modelId and topologyHash (length-prefixed)
 *   • bus/branch number index arrays (Uint32)
 *   • Float64 PTDF data (row-major)
 *
 * Binary layout:
 *   [0..3]    magic "PTDF" (4 ASCII bytes)
 *   [4..7]    version = 1 (uint32 LE)
 *   [8..11]   rows (uint32 LE)
 *   [12..15]  cols (uint32 LE)
 *   [16..19]  slackBusNumber (uint32 LE)
 *   [20..27]  computedAt (float64 LE, ms since epoch)
 *   [28..31]  modelId byte length (uint32 LE)
 *   [32..31+M] modelId UTF-8 bytes
 *   [32+M..35+M]  topologyHash byte length (uint32 LE, 0 = absent)
 *   [36+M..35+M+H] topologyHash UTF-8 bytes
 *   then: cols × 4 bytes (busNumbers Uint32)
 *   then: rows × 4 bytes (branchNumbers Uint32)
 *   then: rows × cols × 8 bytes (Float64 PTDF data, row-major)
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PtdfMatrix, PtdfStorageAdapter } from "./types";

const BUCKET = "ptdf-cache";
const MAGIC = 0x46445450; // "PTDF" as uint32

function storagePath(tenantId: string, modelId: string): string {
  return `${tenantId}/${modelId}.ptdf`;
}

// ── Serialisation ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

export function serialisePtdf(matrix: PtdfMatrix): Uint8Array {
  const modelIdBytes = enc.encode(matrix.modelId);
  const hashBytes = matrix.topologyHash ? enc.encode(matrix.topologyHash) : new Uint8Array(0);
  const M = modelIdBytes.length;
  const H = hashBytes.length;
  const rows = matrix.rows;
  const cols = matrix.cols;

  const headerSize = 4 + 4 + 4 + 4 + 4 + 8 + 4 + M + 4 + H;
  const indexSize = cols * 4 + rows * 4;
  const dataSize = rows * cols * 8;
  const totalSize = headerSize + indexSize + dataSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  let off = 0;

  view.setUint32(off, MAGIC, true); off += 4;
  view.setUint32(off, 1, true); off += 4;
  view.setUint32(off, rows, true); off += 4;
  view.setUint32(off, cols, true); off += 4;
  view.setUint32(off, matrix.slackBusNumber, true); off += 4;
  view.setFloat64(off, Date.parse(matrix.computedAt), true); off += 8;

  view.setUint32(off, M, true); off += 4;
  new Uint8Array(buf).set(modelIdBytes, off); off += M;

  view.setUint32(off, H, true); off += 4;
  if (H > 0) { new Uint8Array(buf).set(hashBytes, off); off += H; }

  for (let i = 0; i < cols; i++) {
    view.setUint32(off, matrix.busNumbers[i], true); off += 4;
  }
  for (let i = 0; i < rows; i++) {
    view.setUint32(off, matrix.branchNumbers[i], true); off += 4;
  }
  // Float64 data — write via DataView to avoid alignment constraints
  for (let i = 0; i < rows * cols; i++) {
    view.setFloat64(off, matrix.data[i], true); off += 8;
  }

  return new Uint8Array(buf);
}

export function deserialisePtdf(bytes: Uint8Array): PtdfMatrix {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;

  const magic = view.getUint32(off, true); off += 4;
  if (magic !== MAGIC) throw new Error("[PtdfStorage] Invalid magic bytes — not a PTDF file");

  const version = view.getUint32(off, true); off += 4;
  if (version !== 1) throw new Error(`[PtdfStorage] Unsupported version ${version}`);

  const rows = view.getUint32(off, true); off += 4;
  const cols = view.getUint32(off, true); off += 4;
  const slackBusNumber = view.getUint32(off, true); off += 4;
  const tsMs = view.getFloat64(off, true); off += 8;
  const computedAt = new Date(tsMs).toISOString();

  const M = view.getUint32(off, true); off += 4;
  const modelId = dec.decode(bytes.subarray(off, off + M)); off += M;

  const H = view.getUint32(off, true); off += 4;
  const topologyHash = H > 0 ? dec.decode(bytes.subarray(off, off + H)) : null; off += H;

  const busNumbers: number[] = [];
  for (let i = 0; i < cols; i++) {
    busNumbers.push(view.getUint32(off, true)); off += 4;
  }
  const branchNumbers: number[] = [];
  for (let i = 0; i < rows; i++) {
    branchNumbers.push(view.getUint32(off, true)); off += 4;
  }

  // Read Float64 data via DataView to avoid alignment constraints
  const data = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    data[i] = view.getFloat64(off, true); off += 8;
  }

  return {
    modelId,
    slackBusNumber,
    busNumbers,
    branchNumbers,
    data,
    rows,
    cols,
    computedAt,
    topologyHash,
  };
}

// ── Supabase Storage adapter ──────────────────────────────────────────────────

export class SupabasePtdfStorage implements PtdfStorageAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async load(tenantId: string, modelId: string): Promise<PtdfMatrix | null> {
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
      throw new Error(`[PtdfStorage.load] ${error.message}`);
    }
    if (!data) return null;

    const bytes = new Uint8Array(await data.arrayBuffer());
    return deserialisePtdf(bytes);
  }

  async store(tenantId: string, matrix: PtdfMatrix): Promise<void> {
    const path = storagePath(tenantId, modelId(matrix));
    const bytes = serialisePtdf(matrix);
    const blob = new Blob([bytes], { type: "application/octet-stream" });

    const { error } = await this.client.storage
      .from(BUCKET)
      .upload(path, blob, { upsert: true });

    if (error) {
      throw new Error(`[PtdfStorage.store] ${error.message}`);
    }
  }

  async invalidate(tenantId: string, modelIdStr: string): Promise<void> {
    const path = storagePath(tenantId, modelIdStr);
    const { error } = await this.client.storage
      .from(BUCKET)
      .remove([path]);

    // Tolerate "not found" — already invalidated
    if (error && !error.message?.includes("not found") && !error.message?.includes("404")) {
      throw new Error(`[PtdfStorage.invalidate] ${error.message}`);
    }
  }
}

function modelId(matrix: PtdfMatrix): string {
  return matrix.modelId;
}

// ── In-memory adapter (for testing) ──────────────────────────────────────────

export class InMemoryPtdfStorage implements PtdfStorageAdapter {
  private readonly cache = new Map<string, PtdfMatrix>();

  private cacheKey(tenantId: string, modelId: string): string {
    return `${tenantId}/${modelId}`;
  }

  async load(tenantId: string, modelId: string): Promise<PtdfMatrix | null> {
    return this.cache.get(this.cacheKey(tenantId, modelId)) ?? null;
  }

  async store(tenantId: string, matrix: PtdfMatrix): Promise<void> {
    this.cache.set(this.cacheKey(tenantId, matrix.modelId), matrix);
  }

  async invalidate(tenantId: string, modelId: string): Promise<void> {
    this.cache.delete(this.cacheKey(tenantId, modelId));
  }
}
