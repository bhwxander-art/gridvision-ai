import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { createAIProvider, GRID_SYSTEM_PROMPT } from "@/lib/ai/service";
import { buildGridContextSnapshot, formatContextForPrompt } from "@/lib/ai/context";
import type { ChatMessage, GridContextSnapshot } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<Response> {
  // Auth — 401 if no tenant context
  try {
    await requireTenant();
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse body
  let messages: ChatMessage[];
  let clientSnapshot: GridContextSnapshot | undefined;
  try {
    const body = await req.json();
    messages = body.messages;
    clientSnapshot = body.snapshot;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (messages.length > 40) {
      return new Response(
        JSON.stringify({ error: "Conversation too long. Clear the chat and start fresh." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "AI service is not configured" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Build context snapshot (use client snapshot if provided, else fetch fresh)
  const snapshot = clientSnapshot ?? (await buildGridContextSnapshot());
  const contextText = formatContextForPrompt(snapshot);

  const systemPrompt = `${GRID_SYSTEM_PROMPT}\n\n${contextText}`;

  const provider = createAIProvider();

  // Return SSE stream
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of provider.stream(systemPrompt, messages, {
          signal: abortController.signal,
        })) {
          const chunk = JSON.stringify({ type: "delta", text });
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        const done = JSON.stringify({ type: "done" });
        controller.enqueue(encoder.encode(`data: ${done}\n\n`));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        const error = JSON.stringify({ type: "error", error: msg });
        controller.enqueue(encoder.encode(`data: ${error}\n\n`));
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
