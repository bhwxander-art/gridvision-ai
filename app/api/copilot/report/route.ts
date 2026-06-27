import "server-only";
import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { createAIProvider, EXECUTIVE_REPORT_SYSTEM_PROMPT } from "@/lib/ai/service";
import { buildGridContextSnapshot, formatContextForPrompt } from "@/lib/ai/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ExecutiveReportSections {
  executiveSummary: string;
  keyRisks: string;
  opportunities: string;
  recommendedActions: string;
  operationalInsights: string;
  forecastInterpretation: string;
  capacityPlanningSuggestions: string;
}

interface ExecutiveReport {
  generatedAt: string;
  sections: ExecutiveReportSections;
}

function extractSection(raw: string, header: string): string {
  const idx = raw.indexOf(`## ${header}`);
  if (idx === -1) return "";
  const start = idx + `## ${header}`.length;
  const nextHeader = raw.indexOf("\n## ", start);
  const end = nextHeader === -1 ? raw.length : nextHeader;
  return raw.slice(start, end).replace(/^\n+/, "").trimEnd();
}

export async function POST(): Promise<NextResponse<ExecutiveReport | { error: string }>> {
  // Auth — 401 if no tenant context
  try {
    await requireTenant();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI service is not configured" },
      { status: 503 }
    );
  }

  try {
    const snapshot = await buildGridContextSnapshot();
    const contextText = formatContextForPrompt(snapshot);

    const userPrompt = `Generate a complete executive grid intelligence report based on the following live data:

${contextText}

Structure with these EXACT ## section headers:
## Executive Summary
## Key Risks
## Opportunities
## Recommended Actions
## Operational Insights
## Forecast Interpretation
## Capacity Planning Suggestions

Be specific. Reference actual MW values, percentages, and scores. Keep each section focused and board-ready.`;

    const provider = createAIProvider();
    const raw = await provider.complete(EXECUTIVE_REPORT_SYSTEM_PROMPT, [
      { role: "user", content: userPrompt },
    ]);

    const sections: ExecutiveReportSections = {
      executiveSummary:            extractSection(raw, "Executive Summary"),
      keyRisks:                    extractSection(raw, "Key Risks"),
      opportunities:               extractSection(raw, "Opportunities"),
      recommendedActions:          extractSection(raw, "Recommended Actions"),
      operationalInsights:         extractSection(raw, "Operational Insights"),
      forecastInterpretation:      extractSection(raw, "Forecast Interpretation"),
      capacityPlanningSuggestions: extractSection(raw, "Capacity Planning Suggestions"),
    };

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sections,
    });
  } catch (err) {
    console.error("[api/copilot/report]", err);
    return NextResponse.json(
      { error: "Report generation failed" },
      { status: 500 }
    );
  }
}
