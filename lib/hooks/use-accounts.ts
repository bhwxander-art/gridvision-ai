"use client";

import { useCallback, useEffect, useState } from "react";
import type { Account } from "@/lib/data/accounts";
import { accounts as mockAccounts } from "@/lib/data/accounts";
import type { AccountsResponse } from "@/app/api/accounts/route";
import type { ProvenanceInfo } from "@/lib/provenance";

interface UseAccountsResult {
  accounts: Account[];
  tenantId: string | null;
  source: "db" | "mock";
  provenance: ProvenanceInfo | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAccounts(): UseAccountsResult {
  const [accounts, setAccounts] = useState<Account[]>(mockAccounts);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "mock">("mock");
  const [provenance, setProvenance] = useState<ProvenanceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/accounts", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`/api/accounts returned ${res.status}`);
        return res.json() as Promise<AccountsResponse>;
      })
      .then((d) => {
        setAccounts(d.accounts);
        setTenantId(d.tenantId);
        setSource(d.source);
        setProvenance(d._provenance ?? null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [fetchKey]);

  return { accounts, tenantId, source, provenance, loading, error, refetch };
}
