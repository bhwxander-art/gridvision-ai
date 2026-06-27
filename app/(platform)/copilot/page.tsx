"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Zap, FileText, Trash2, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/copilot/message-bubble";
import { SuggestedQuestions } from "@/components/copilot/suggested-questions";
import type { ChatMessage, GridContextSnapshot } from "@/lib/ai/types";

interface ExecutiveReportData {
  generatedAt: string;
  sections: Record<string, string>;
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GridContextSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportData, setReportData] = useState<ExecutiveReportData | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch grid context on mount and add welcome message
  useEffect(() => {
    Promise.all([
      fetch("/api/grid/health-score")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/load/iso-current")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([health, load]) => {
      const snap: GridContextSnapshot = {
        currentLoadMW: (load as { current_load_mw?: number } | null)?.current_load_mw ?? null,
        forecastLoadMW: (load as { forecast_load_mw?: number } | null)?.forecast_load_mw ?? null,
        loadTimestamp: (load as { timestamp?: string } | null)?.timestamp ?? null,
        healthScore: (health as { score?: number } | null)?.score ?? null,
        healthStatus:
          (health as { status?: "stable" | "elevated" | "critical" } | null)?.status ?? null,
        healthRecommendation:
          (health as { recommendation?: string } | null)?.recommendation ?? null,
        capacityMW: 8400,
        utilizationPct:
          (load as { current_load_mw?: number } | null)?.current_load_mw
            ? Math.round(
                ((load as { current_load_mw: number }).current_load_mw / 8400) * 100
              )
            : null,
        historyCount: null,
        avgLoad24hMW: null,
        peakLoad24hMW: null,
        fetchedAt: new Date().toISOString(),
      };
      setSnapshot(snap);
      setSnapshotLoading(false);

      const currentLoadMW = snap.currentLoadMW;
      const healthScore = snap.healthScore;
      const healthStatus = snap.healthStatus;

      setMessages([
        {
          role: "assistant",
          content: `Welcome to the **AI Grid Copilot** — your intelligent assistant for ISO-NE grid operations and planning.\n\n${
            currentLoadMW
              ? `I can see the grid is currently running at **${currentLoadMW.toLocaleString()} MW**${
                  healthScore
                    ? ` with a Grid Health Score of **${healthScore}/100** (${healthStatus?.toUpperCase()})`
                    : ""
                }.`
              : "I'm ready to help with grid analysis, capacity planning, and operational questions."
          }\n\nAsk me anything, or pick a question below to get started.`,
          id: "welcome",
        },
      ]);
    });

    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  async function sendMessage(content?: string) {
    const text = (content ?? input).trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      id: crypto.randomUUID(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, snapshot }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 401) {
          setError("Sign in to use the AI Copilot.");
        } else if (res.status === 503) {
          setError("AI Copilot is not configured. Contact your administrator.");
        } else {
          setError(body.error ?? `Error ${res.status}`);
        }
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json) as {
              type: string;
              text?: string;
              error?: string;
            };
            if (event.type === "delta" && event.text) {
              accumulated += event.text;
              setStreamingText(accumulated);
            } else if (event.type === "done") {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: accumulated,
                  id: crypto.randomUUID(),
                },
              ]);
              setStreamingText("");
            } else if (event.type === "error") {
              setError(event.error ?? "AI error");
            }
          } catch {
            /* ignore SSE parse errors */
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  async function generateReport() {
    setReportLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/copilot/report", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Report generation failed");
        return;
      }
      const data = (await res.json()) as ExecutiveReportData;
      setReportData(data);
      setReportOpen(true);
    } catch {
      setError("Report generation failed");
    } finally {
      setReportLoading(false);
    }
  }

  function clearConversation() {
    abortRef.current?.abort();
    setMessages((prev) => prev.slice(0, 1)); // keep welcome
    setStreamingText("");
    setError(null);
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex-none border-b border-border/40 bg-[#0d1219]/80 px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan-400" />
            <div>
              <h1 className="text-base font-semibold">AI Grid Copilot</h1>
              <p className="text-xs text-muted-foreground">
                ISO-NE Grid Intelligence · Powered by Claude
              </p>
            </div>
          </div>

          {/* Context status bar */}
          <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
            {snapshotLoading ? (
              <div className="h-3 w-40 animate-pulse rounded bg-border/30" />
            ) : snapshot ? (
              <>
                {snapshot.currentLoadMW != null && (
                  <span>
                    Load:{" "}
                    <span className="font-mono text-foreground">
                      {snapshot.currentLoadMW.toLocaleString()} MW
                    </span>
                  </span>
                )}
                {snapshot.healthScore != null && (
                  <span>
                    Health:{" "}
                    <span
                      className={`font-mono ${
                        snapshot.healthStatus === "critical"
                          ? "text-red-400"
                          : snapshot.healthStatus === "elevated"
                          ? "text-yellow-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {snapshot.healthScore}/100
                    </span>
                  </span>
                )}
                {snapshot.utilizationPct != null && (
                  <span>
                    Util:{" "}
                    <span className="font-mono text-foreground">
                      {snapshot.utilizationPct}%
                    </span>
                  </span>
                )}
              </>
            ) : null}
          </div>

          {/* Report button */}
          <Button
            onClick={generateReport}
            disabled={reportLoading}
            size="sm"
            variant="outline"
            className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
          >
            {reportLoading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <FileText className="mr-1 h-3 w-3" />
            )}
            {reportLoading ? "Generating…" : "Executive Report"}
          </Button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-4">
          {/* Loading skeleton shown before welcome message arrives */}
          {messages.length === 0 && snapshotLoading && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10">
                <Zap className="h-3.5 w-3.5 text-cyan-400" />
              </div>
              <div className="max-w-[85%] space-y-2 rounded-2xl rounded-tl-sm border border-border/40 bg-[#0d1219]/60 px-4 py-3">
                <div className="h-3 w-48 animate-pulse rounded bg-border/30" />
                <div className="h-3 w-64 animate-pulse rounded bg-border/30" />
                <div className="h-3 w-40 animate-pulse rounded bg-border/30" />
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id ?? msg.content.slice(0, 20)}
              role={msg.role}
              content={msg.content}
            />
          ))}
          {streamingText && (
            <MessageBubble role="assistant" content={streamingText} isStreaming />
          )}
          {streaming && !streamingText && (
            <div className="flex items-center gap-2 px-1">
              <Zap className="h-4 w-4 text-cyan-400" />
              <div className="flex gap-1">
                <span className="animate-bounce text-cyan-400 [animation-delay:0ms]">·</span>
                <span className="animate-bounce text-cyan-400 [animation-delay:150ms]">·</span>
                <span className="animate-bounce text-cyan-400 [animation-delay:300ms]">·</span>
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {/* Suggested questions — only when ≤ 1 messages (just welcome) */}
          {messages.length <= 1 && !streaming && (
            <SuggestedQuestions
              onSelect={sendMessage}
              healthScore={snapshot?.healthScore ?? null}
            />
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="flex-none border-t border-border/40 bg-[#0d1219]/80 px-4 py-3">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask anything about your grid…"
              aria-label="Chat message input"
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
              style={{ maxHeight: "120px", overflowY: "auto" }}
            />
            <div className="flex shrink-0 gap-1">
              <Button
                onClick={clearConversation}
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                title="Clear conversation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => void sendMessage()}
                disabled={streaming || !input.trim()}
                size="icon"
                className="h-9 w-9 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40">
            Enter to send · Shift+Enter for newline · Live ISO-NE data
          </p>
        </div>
      </div>

      {/* Executive Report Panel */}
      {reportOpen && reportData && (
        <div className="max-h-[40vh] flex-none overflow-y-auto border-t border-border/40 bg-[#0a0f16]">
          <div className="mx-auto max-w-4xl px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Executive Grid Intelligence Report
              </h2>
              <button
                onClick={() => setReportOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(reportData.sections).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-border/40 bg-[#0d1219]/60 p-3"
                >
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </h3>
                  <div className="text-xs">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => <p className="mb-1 font-semibold text-foreground">{children}</p>,
                        h2: ({ children }) => <p className="mb-1 font-semibold text-foreground">{children}</p>,
                        h3: ({ children }) => <p className="mb-0.5 font-medium text-foreground/80">{children}</p>,
                        p: ({ children }) => <p className="mb-1.5 leading-relaxed text-muted-foreground last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-3">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-3">{children}</ol>,
                        li: ({ children }) => <li className="text-muted-foreground">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                      }}
                    >
                      {String(value)}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground/40">
              Generated{" "}
              {reportData.generatedAt
                ? new Date(reportData.generatedAt).toLocaleString()
                : "just now"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
