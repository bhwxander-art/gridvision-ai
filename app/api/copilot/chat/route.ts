import "server-only";
import { type NextRequest } from "next/server";
import { requireTenant } from "@/lib/auth/tenant";
import { createAIProvider, getAiConfigError, GRID_SYSTEM_PROMPT } from "@/lib/ai/service";
import { buildGridContextSnapshot, formatContextForPrompt } from "@/lib/ai/context";
import { getServerClient, isDbConfigured } from "@/lib/db/client";
import { ChatSessionRepository } from "@/lib/db/repositories/chat-session.repository";
import type { ChatMessage, GridContextSnapshot } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<Response> {
  // Auth — 401 if no tenant context
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse body
  let messages: ChatMessage[];
  let clientSnapshot: GridContextSnapshot | undefined;
  let sessionId: string | undefined;
  try {
    const body = await req.json() as {
      messages: ChatMessage[];
      snapshot?: GridContextSnapshot;
      sessionId?: string;
    };
    messages = body.messages;
    clientSnapshot = body.snapshot;
    sessionId = body.sessionId;

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
  const aiConfigError = getAiConfigError();
  if (aiConfigError) {
    return new Response(
      JSON.stringify({ error: aiConfigError }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Validate session ownership (if provided)
  if (sessionId && isDbConfigured()) {
    const repo = new ChatSessionRepository(getServerClient());
    const session = await repo.getSession(sessionId, ctx.tenantId).catch(() => null);
    if (!session) {
      sessionId = undefined; // Ignore invalid session — don't persist
    }
  }

  // Build context snapshot (use client snapshot if provided, else fetch fresh)
  const snapshot = clientSnapshot ?? (await buildGridContextSnapshot());
  const contextText = formatContextForPrompt(snapshot);

  const systemPrompt = `${GRID_SYSTEM_PROMPT}\n\n${contextText}`;

  const provider = createAIProvider();

  // Capture context for use inside the stream
  const capturedSessionId = sessionId;
  const capturedMessages = messages;

  // Return SSE stream
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      try {
        for await (const text of provider.stream(systemPrompt, capturedMessages, {
          signal: abortController.signal,
        })) {
          assistantText += text;
          const chunk = JSON.stringify({ type: "delta", text });
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        const done = JSON.stringify({ type: "done" });
        controller.enqueue(encoder.encode(`data: ${done}\n\n`));

        // Persist messages to session after streaming completes
        if (capturedSessionId && isDbConfigured()) {
          const repo = new ChatSessionRepository(getServerClient());
          const userMsg = capturedMessages[capturedMessages.length - 1];
          if (userMsg?.role === "user") {
            await repo.addMessage(capturedSessionId, "user", userMsg.content).catch(() => {});
          }
          if (assistantText) {
            await repo.addMessage(capturedSessionId, "assistant", assistantText).catch(() => {});
          }
        }

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
