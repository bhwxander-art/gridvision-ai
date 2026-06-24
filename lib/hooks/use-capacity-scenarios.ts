"use client";

import { useCallback, useEffect, useState } from "react";

export type CopilotRiskDisplay = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CapacityScenario {
  id: string;
  name: string;
  addedMW: number;
  projectedUtilizationPct: number;
  headroomMW: number;
  riskLevel: CopilotRiskDisplay;
  timestamp: string;
}

const STORAGE_KEY = "gv-capacity-scenarios-v1";

function load(): CapacityScenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CapacityScenario[]) : [];
  } catch {
    return [];
  }
}

function persist(scenarios: CapacityScenario[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
  } catch {}
}

export function useCapacityScenarios() {
  const [scenarios, setScenarios] = useState<CapacityScenario[]>([]);
  const [scenarioA, setScenarioA] = useState<CapacityScenario | null>(null);
  const [scenarioB, setScenarioB] = useState<CapacityScenario | null>(null);

  // Hydrate from localStorage after mount
  useEffect(() => {
    setScenarios(load());
  }, []);

  const updateScenarios = useCallback((next: CapacityScenario[]) => {
    setScenarios(next);
    persist(next);
  }, []);

  const saveScenario = useCallback(
    (
      name: string,
      data: Pick<
        CapacityScenario,
        "addedMW" | "projectedUtilizationPct" | "headroomMW" | "riskLevel"
      >
    ) => {
      const scenario: CapacityScenario = {
        id: crypto.randomUUID(),
        name: name.trim(),
        timestamp: new Date().toISOString(),
        ...data,
      };
      updateScenarios([scenario, ...scenarios]);
      return scenario;
    },
    [scenarios, updateScenarios]
  );

  const renameScenario = useCallback(
    (id: string, name: string) => {
      updateScenarios(
        scenarios.map((s) => (s.id === id ? { ...s, name: name.trim() } : s))
      );
      // Keep A/B slots in sync with the rename
      setScenarioA((a) => (a?.id === id ? { ...a, name: name.trim() } : a));
      setScenarioB((b) => (b?.id === id ? { ...b, name: name.trim() } : b));
    },
    [scenarios, updateScenarios]
  );

  const deleteScenario = useCallback(
    (id: string) => {
      updateScenarios(scenarios.filter((s) => s.id !== id));
      setScenarioA((a) => (a?.id === id ? null : a));
      setScenarioB((b) => (b?.id === id ? null : b));
    },
    [scenarios, updateScenarios]
  );

  const assignSlot = useCallback(
    (slot: "A" | "B", scenario: CapacityScenario | null) => {
      if (slot === "A") setScenarioA(scenario);
      else setScenarioB(scenario);
    },
    []
  );

  return {
    scenarios,
    scenarioA,
    scenarioB,
    saveScenario,
    renameScenario,
    deleteScenario,
    assignSlot,
  };
}
