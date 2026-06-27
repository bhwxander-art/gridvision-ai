"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Zap,
  FileText,
  Trash2,
  Send,
  Loader2,
  MessageSquare,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Pencil,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/copilot/message-bubble";
import { SuggestedQuestions } from "@/components/copilot/suggested-questions";
import type { ChatMessage, GridContextSnapshot } from "@/lib/ai/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExecutiveReportData {
  generatedAt: string;
  sections: Record<string, string>;
}

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface DbChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function makeWelcomeMessage(snap: GridContextSnapshot | null): ChatMessage {
  const currentLoadMW = snap?.currentLoadMW;
  const healthScore = snap?.healthScore;
  const healthStatus = snap?.healthStatus;
  return {
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
  };
}

// ── Session Sidebar ───────────────────────────────────────────────────────────

function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  collapsed,
  onToggleCollapse,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  function startEdit(session: ChatSession) {
    setEditingId(session.id);
    setEditTitle(session.title);
  }

  function commitEdit(id: string) {
    if (editTitle.trim()) {
      onRenameSession(id, editTitle.trim());
    }
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <div className="flex w-10 flex-none flex-col items-center border-r border-border/40 bg-[#0a0f16] py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          title="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-56 flex-none flex-col border-r border-border/40 bg-[#0a0f16]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Conversations
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* New chat button */}
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={onNewSession}
          className="flex w-full items-center gap-2 rounded-md border border-border/40 bg-background/20 px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground/60">
            No conversations yet
          </p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  activeSessionId === session.id
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                }`}
              >
                {editingId === session.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      ref={editRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(session.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => commitEdit(session.id)}
                      className="min-w-0 flex-1 rounded border border-primary/50 bg-background/80 px-1.5 py-0.5 text-xs text-foreground outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => commitEdit(session.id)}
                      className="shrink-0 text-emerald-400"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectSession(session.id)}
                      onDoubleClick={() => startEdit(session)}
                    >
                      <div className="truncate text-xs font-medium leading-snug">
                        {session.title}
                      </div>
                      <div className="text-[10px] opacity-60">
                        {relativeTime(session.updated_at)}
                      </div>
                    </button>
                    <div className="absolute right-1 flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(session)}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSession(session.id)}
                        className="rounded p-0.5 text-muted-foreground hover:text-red-400"
                        title="Delete"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

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

  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false); // mobile

  async function loadSessions() {
    try {
      const res = await fetch("/api/copilot/sessions");
      if (!res.ok) return;
      const d = (await res.json()) as { sessions: ChatSession[] };
      setSessions(d.sessions ?? []);
    } catch {
      /* sessions are optional */
    }
  }

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
      setMessages([makeWelcomeMessage(snap)]);
    });

    void loadSessions();

    return () => {
      abortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSelectSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/copilot/sessions/${id}`);
      if (!res.ok) return;
      const d = (await res.json()) as {
        session: ChatSession;
        messages: DbChatMessage[];
      };
      setSessionId(id);
      const loaded: ChatMessage[] = d.messages.map((m) => ({
        role: m.role,
        content: m.content,
        id: m.id,
      }));
      setMessages(loaded.length > 0 ? loaded : [makeWelcomeMessage(null)]);
      setStreamingText("");
      setError(null);
    } catch {
      setError("Failed to load session");
    }
  }, []);

  async function handleNewSession() {
    try {
      const res = await fetch("/api/copilot/sessions", { method: "POST" });
      if (res.ok) {
        const session = (await res.json()) as ChatSession;
        setSessionId(session.id);
        setSessions((prev) => [session, ...prev]);
      } else {
        setSessionId(null);
      }
    } catch {
      setSessionId(null);
    }
    setMessages([makeWelcomeMessage(snapshot)]);
    setStreamingText("");
    setError(null);
  }

  async function handleDeleteSession(id: string) {
    try {
      await fetch(`/api/copilot/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (sessionId === id) {
        setSessionId(null);
        setMessages([makeWelcomeMessage(snapshot)]);
      }
    } catch {
      /* ignore */
    }
  }

  async function handleRenameSession(id: string, title: string) {
    try {
      await fetch(`/api/copilot/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title } : s))
      );
    } catch {
      /* ignore */
    }
  }

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
        body: JSON.stringify({
          messages: nextMessages,
          snapshot,
          ...(sessionId ? { sessionId } : {}),
        }),
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
              // Refresh sessions list to update updated_at
              void loadSessions();
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
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar — desktop */}
      <div className="hidden sm:flex">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={sessionId}
          onSelectSession={(id) => void handleSelectSession(id)}
          onNewSession={() => void handleNewSession()}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          onRenameSession={(id, title) => void handleRenameSession(id, title)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarVisible && (
        <div
          className="fixed inset-0 z-40 flex sm:hidden"
          onClick={() => setSidebarVisible(false)}
        >
          <div
            className="relative flex h-full w-64 flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <SessionSidebar
              sessions={sessions}
              activeSessionId={sessionId}
              onSelectSession={(id) => {
                void handleSelectSession(id);
                setSidebarVisible(false);
              }}
              onNewSession={() => {
                void handleNewSession();
                setSidebarVisible(false);
              }}
              onDeleteSession={(id) => void handleDeleteSession(id)}
              onRenameSession={(id, title) => void handleRenameSession(id, title)}
              collapsed={false}
              onToggleCollapse={() => setSidebarVisible(false)}
            />
          </div>
          <div className="flex-1 bg-black/50" />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-none border-b border-border/40 bg-[#0d1219]/80 px-4 py-3">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Mobile sidebar toggle */}
              <button
                type="button"
                className="mr-1 rounded-md p-1 text-muted-foreground hover:text-foreground sm:hidden"
                onClick={() => setSidebarVisible(true)}
                title="Open conversations"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
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
              onClick={() => void generateReport()}
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
            {/* Suggested questions — only when <= 1 messages (just welcome) */}
            {messages.length <= 1 && !streaming && (
              <SuggestedQuestions
                onSelect={(q) => void sendMessage(q)}
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
                          h1: ({ children }) => (
                            <p className="mb-1 font-semibold text-foreground">{children}</p>
                          ),
                          h2: ({ children }) => (
                            <p className="mb-1 font-semibold text-foreground">{children}</p>
                          ),
                          h3: ({ children }) => (
                            <p className="mb-0.5 font-medium text-foreground/80">{children}</p>
                          ),
                          p: ({ children }) => (
                            <p className="mb-1.5 leading-relaxed text-muted-foreground last:mb-0">
                              {children}
                            </p>
                          ),
                          ul: ({ children }) => (
                            <ul className="mb-1.5 list-disc space-y-0.5 pl-3">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="mb-1.5 list-decimal space-y-0.5 pl-3">{children}</ol>
                          ),
                          li: ({ children }) => (
                            <li className="text-muted-foreground">{children}</li>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-semibold text-foreground">{children}</strong>
                          ),
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
    </div>
  );
}
