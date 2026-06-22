export interface ProvenanceInfo {
  source: string;
  timestamp: string;
  freshness: "live" | "delayed" | "mock";
  isMock: boolean;
}

export function computeFreshness(
  timestamp: string,
  isMock: boolean
): ProvenanceInfo["freshness"] {
  if (isMock) return "mock";
  const ageMinutes = (Date.now() - new Date(timestamp).getTime()) / 60_000;
  if (ageMinutes < 5) return "live";
  return "delayed";
}

export function makeProvenance(
  source: string,
  timestamp: string,
  isMock: boolean
): ProvenanceInfo {
  return { source, timestamp, freshness: computeFreshness(timestamp, isMock), isMock };
}

export function mockProvenance(source = "GridVision (mock)"): ProvenanceInfo {
  return {
    source,
    timestamp: new Date().toISOString(),
    freshness: "mock",
    isMock: true,
  };
}
