"use client";

import { useCallback, useEffect, useState } from "react";
import type { SubstationPlan, FeederCircuit } from "@/lib/types";
import type { TransformerAsset } from "@/lib/planning-engine";
import type { UpgradeProject } from "@/lib/data/capital-projects";
import type { DbProjectStatus } from "@/lib/db/types";

// ── Managed types (domain type + DB audit timestamps) ────────────────────────

export type ManagedSubstation = SubstationPlan & { createdAt: string; updatedAt: string };
export type ManagedTransformer = TransformerAsset & { createdAt: string; updatedAt: string };
export type ManagedFeeder = FeederCircuit & { createdAt: string; updatedAt: string };
export type ManagedCapitalProject = UpgradeProject & {
  status: DbProjectStatus;
  createdAt: string;
  updatedAt: string;
};

// ── Generic CRUD hook factory ─────────────────────────────────────────────────

function useCrudAsset<T>(endpoint: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      // Response shape: { [key]: T[], count: number }
      const key = Object.keys(data).find((k) => Array.isArray(data[k]));
      setItems(key ? (data[key] as T[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void refetch(); }, [refetch]);

  const create = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
        await refetch();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    [endpoint, refetch]
  );

  const update = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(`${endpoint}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
        await refetch();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    [endpoint, refetch]
  );

  const remove = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(`${endpoint}/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
        }
        await refetch();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    [endpoint, refetch]
  );

  return { items, loading, error, refetch, create, update, remove };
}

// ── Per-resource hooks ────────────────────────────────────────────────────────

export function useManagedSubstations() {
  return useCrudAsset<ManagedSubstation>("/api/assets/substations");
}

export function useManagedTransformers() {
  return useCrudAsset<ManagedTransformer>("/api/assets/transformers");
}

export function useManagedFeeders() {
  return useCrudAsset<ManagedFeeder>("/api/assets/feeders");
}

export function useManagedCapitalProjects() {
  return useCrudAsset<ManagedCapitalProject>("/api/assets/capital-projects");
}
