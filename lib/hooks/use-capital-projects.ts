"use client";

import { useCallback, useEffect, useState } from "react";
import type { UpgradeProject } from "@/lib/data/capital-projects";
import { capitalProjects as mockProjects } from "@/lib/data/capital-projects";
import type { CapitalProjectsResponse } from "@/app/api/capital-projects/route";

interface UseCapitalProjectsResult {
  projects: UpgradeProject[];
  source: "db" | "mock";
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useCapitalProjects(): UseCapitalProjectsResult {
  const [projects, setProjects] = useState<UpgradeProject[]>(mockProjects);
  const [source, setSource] = useState<"db" | "mock">("mock");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/capital-projects", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`/api/capital-projects returned ${res.status}`);
        return res.json() as Promise<CapitalProjectsResponse>;
      })
      .then((d) => {
        setProjects(d.projects);
        setSource(d.source);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Keep showing mock data on error — degraded but functional
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [fetchKey]);

  return { projects, source, loading, error, refetch };
}
