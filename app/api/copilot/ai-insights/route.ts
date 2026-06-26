import "server-only";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireTenant } from "@/lib/auth/tenant";
import type { PlanningRecommendation } from "@/lib/copilot-engine";

export const dynamic = "force-dynamic";

interface AiInsightsRequest {
  recommendations: PlanningRecommendation[];
  systemRiskScore: number;
  portfolioSummary: {
    substationCount: number;
    criticalCount: number;
    dcQueueMW: number;
  };
}

interface AiInsightsResponse {
  summary: string;
  planningNote: string;
  enrichedRecommendations: Array<{ id: string; narrative: string }>;
}

const SYSTEM_PROMPT = `You are GridVision AI's planning intelligence engine. You assist utility engineers and planners with grid capacity planning decisions. You have deep expertise in distribution planning, interconnection analysis, NERC reliability standards, and capital program management.

You will receive structured analysis from the deterministic planning engine (risk scores, capacity calculations, CAPEX estimates) and your job is to provide executive-ready narrative intelligence — not to recalculate numbers, but to provide strategic context that helps utility planners communicate with boards, regulators, and operations teams.

Be concise, technical, and actionable. Avoid generic platitudes. Reference specific assets and numbers from the data provided.`;

export async function POST(req: NextRequest): Promise<NextResponse<AiInsightsResponse | { error: string }>> {
  try {
    await requireTenant();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Graceful fallback when API key is not configured
  if (!apiKey) {
    return NextResponse.json({
      summary: "",
      planningNote: "",
      enrichedRecommendations: [],
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { recommendations, systemRiskScore, portfolioSummary } = body as AiInsightsRequest;

  if (!Array.isArray(recommendations) || typeof systemRiskScore !== "number") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }

  const top5 = recommendations.slice(0, 5);
  const recList = top5
    .map((r) =>
      `[${r.id}] ${r.urgency.toUpperCase()} — ${r.title}\n  Rationale: ${r.rationale}`
    )
    .join("\n\n");

  const userMessage = `System Risk Score: ${systemRiskScore}/100
Portfolio: ${portfolioSummary.substationCount} substations, ${portfolioSummary.criticalCount} at critical severity, ${portfolioSummary.dcQueueMW} MW pending DC interconnections

Top recommendations from planning engine:
${recList}

Provide:
1. EXECUTIVE SUMMARY (2-3 sentences suitable for a board update)
2. PLANNING NOTE (1 paragraph on the most critical systemic risk)
3. For each recommendation ID listed, provide one sentence of additional strategic context (label as "rec_id: narrative")`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Parse the structured response
    const summaryMatch = responseText.match(
      /1\.\s*EXECUTIVE SUMMARY\s*\n([\s\S]*?)(?=\n2\.|$)/i
    );
    const planningNoteMatch = responseText.match(
      /2\.\s*PLANNING NOTE\s*\n([\s\S]*?)(?=\n3\.|$)/i
    );
    const narrativesSection = responseText.match(
      /3\.\s*(?:For each|Recommendation narratives?|Additional context)[^\n]*\n([\s\S]*?)$/i
    );

    const summary = summaryMatch ? summaryMatch[1].trim() : "";
    const planningNote = planningNoteMatch ? planningNoteMatch[1].trim() : "";

    // Parse individual rec narratives
    const enrichedRecommendations: Array<{ id: string; narrative: string }> = [];
    if (narrativesSection) {
      const lines = narrativesSection[1].split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.+)/);
        if (match) {
          const id = match[1].trim();
          const narrative = match[2].trim();
          if (top5.some((r) => r.id === id)) {
            enrichedRecommendations.push({ id, narrative });
          }
        }
      }
    }

    return NextResponse.json({ summary, planningNote, enrichedRecommendations });
  } catch (err) {
    console.error("[copilot/ai-insights] Anthropic error:", err);
    return NextResponse.json({ error: "AI insights unavailable" }, { status: 500 });
  }
}
