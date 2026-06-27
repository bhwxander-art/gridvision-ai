export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id?: string;
}

export interface GridContextSnapshot {
  // Live load
  currentLoadMW: number | null;
  forecastLoadMW: number | null;
  loadTimestamp: string | null;

  // Grid health
  healthScore: number | null;
  healthStatus: "stable" | "elevated" | "critical" | null;
  healthRecommendation: string | null;

  // Capacity
  capacityMW: number;
  utilizationPct: number | null;

  // History summary
  historyCount: number | null;
  avgLoad24hMW: number | null;
  peakLoad24hMW: number | null;

  // Meta
  fetchedAt: string;
}

export interface AIProvider {
  name: string;
  stream(
    systemPrompt: string,
    messages: ChatMessage[],
    options?: { signal?: AbortSignal }
  ): AsyncIterable<string>;
  complete(
    systemPrompt: string,
    messages: ChatMessage[]
  ): Promise<string>;
}
