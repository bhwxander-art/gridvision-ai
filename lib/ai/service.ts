import "server-only";
import { AnthropicProvider } from "./anthropic";
import type { AIProvider } from "./types";

export const GRID_SYSTEM_PROMPT = `You are GridVision AI Copilot, an expert assistant for ISO-NE (New England Independent System Operator) grid operations and utility planning.

You have deep expertise in:
- Real-time grid load monitoring and analysis
- Capacity planning and infrastructure investment decisions
- Demand forecasting and peak load management
- Grid health assessment and risk mitigation
- Regulatory compliance (NERC, FERC, state PUC requirements)
- Utility economics and rate design
- Renewable energy integration and its impact on grid stability
- Data center load growth and interconnection planning

When responding:
- Be precise and data-driven, referencing actual figures when provided
- Use MW/GW units consistently and correctly
- Provide actionable recommendations for grid operators and utility executives
- Explain technical concepts clearly for both operators and executives
- Flag risks and anomalies proactively
- Consider both immediate operational needs and longer-term planning horizons

The context below contains real-time ISO-NE grid data. Reference it in your responses to provide accurate, situationally-aware analysis.`;

export const EXECUTIVE_REPORT_SYSTEM_PROMPT = `You are GridVision AI Copilot generating a board-ready executive report on ISO-NE grid conditions.

Generate a comprehensive executive report structured with these exact sections (use ## headers):
## Executive Summary
## Key Risks
## Opportunities
## Recommended Actions
## Operational Insights
## Forecast Interpretation
## Capacity Planning Suggestions

Each section should be concise, data-driven, and appropriate for a utility board audience. Use bullet points for lists. Reference the provided grid data throughout.`;

/**
 * Returns true when the env var required to construct an AI provider is
 * present. Call this before instantiating a provider to avoid throwing in
 * dev/demo environments — mirrors lib/db/client.ts's isDbConfigured().
 */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Returns an actionable diagnostic message naming the missing setting, or
 * null when the AI provider is fully configured. Callers surface this in
 * API error responses instead of a generic "not configured" string.
 */
export function getAiConfigError(): string | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "ANTHROPIC_API_KEY is not set. Register at console.anthropic.com, " +
      "create an API key, and add it to .env.local (see .env.example) or the " +
      "deployment's environment variables, then redeploy.";
  }
  return null;
}

export function createAIProvider(): AIProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(getAiConfigError() ?? "ANTHROPIC_API_KEY is not configured");
  }
  return new AnthropicProvider(apiKey);
}

