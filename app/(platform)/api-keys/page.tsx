"use client";

import { useState, useEffect } from "react";
import { Key, Plus, Trash2, Copy, Check, ExternalLink, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  request_count: number;
}

interface NewKeyResult {
  key: string;
  record: ApiKey;
}

const SCOPES = ["read", "write", "admin"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  read: "Read grid data and forecasts",
  write: "Import data and update settings",
  admin: "Full access including key management",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="ml-1 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);

  // Create form state
  const [createName, setCreateName] = useState("");
  const [createScopes, setCreateScopes] = useState<Scope[]>(["read"]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadKeys() {
    try {
      const res = await fetch("/api/keys");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { keys: ApiKey[] };
      setKeys(d.keys ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadKeys(); }, []);

  async function handleCreate() {
    if (!createName.trim() || createScopes.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), scopes: createScopes }),
      });
      const d = await res.json() as NewKeyResult & { error?: string };
      if (!res.ok) {
        setCreateError(d.error ?? "Failed to create key");
        return;
      }
      setNewKeyResult(d);
      setShowCreate(false);
      setCreateName("");
      setCreateScopes(["read"]);
      // Reload list
      await loadKeys();
    } catch {
      setCreateError("Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await fetch(`/api/keys/${id}`, { method: "DELETE" });
      setRevokeConfirm(null);
      await loadKeys();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">API Keys</h1>
          <p className="text-sm text-muted-foreground">
            Manage API keys for external integrations and data access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border/50 text-muted-foreground"
            asChild
          >
            <a href="/api/openapi.json" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              OpenAPI Spec
            </a>
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Create Key
          </Button>
        </div>
      </div>

      {/* New key revealed */}
      {newKeyResult && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-emerald-400">
              <Shield className="h-4 w-4" />
              Key Created — Save It Now
            </CardTitle>
            <CardDescription className="text-emerald-400/70">
              This key will only be shown once. Copy it and store it securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-background/60 px-3 py-2 font-mono text-sm">
              <span className="flex-1 break-all">{newKeyResult.key}</span>
              <CopyButton text={newKeyResult.key} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Name: <strong className="text-foreground">{newKeyResult.record.name}</strong>
              </span>
              <span>
                Scopes:{" "}
                <strong className="text-foreground">
                  {newKeyResult.record.scopes.join(", ")}
                </strong>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-emerald-500/30 text-emerald-400"
              onClick={() => setNewKeyResult(null)}
            >
              I have saved the key
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card className="border-border/60 bg-card/80">
          <CardHeader>
            <CardTitle className="text-sm">Create New API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Production Integration"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Scopes</Label>
              {SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/40 bg-background/30 px-3 py-2.5 hover:border-border"
                >
                  <input
                    type="checkbox"
                    checked={createScopes.includes(scope)}
                    onChange={(e) => {
                      setCreateScopes((prev) =>
                        e.target.checked
                          ? [...prev, scope]
                          : prev.filter((s) => s !== scope)
                      );
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium capitalize">{scope}</div>
                    <div className="text-xs text-muted-foreground">
                      {SCOPE_DESCRIPTIONS[scope]}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => void handleCreate()}
                disabled={creating || !createName.trim() || createScopes.length === 0}
              >
                {creating ? "Creating..." : "Create Key"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key list */}
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-sm">Active Keys</CardTitle>
          <CardDescription>
            Keys are shown by prefix only. The full key is shown once at creation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80"
                />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Key className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No API keys yet</p>
              <p className="text-xs text-muted-foreground/60">
                Create a key to integrate with external systems
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="group flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{key.name}</span>
                      <div className="flex gap-1">
                        {key.scopes.map((s) => (
                          <span
                            key={s}
                            className="rounded border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{key.key_prefix}...</span>
                      <span>Created {relativeTime(key.created_at)}</span>
                      {key.last_used_at && (
                        <span>Last used {relativeTime(key.last_used_at)}</span>
                      )}
                      {key.request_count > 0 && (
                        <span>{key.request_count.toLocaleString()} requests</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {revokeConfirm === key.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-red-400">Revoke?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-2 text-xs"
                          onClick={() => void handleRevoke(key.id)}
                        >
                          Yes
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setRevokeConfirm(null)}
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
                        title="Revoke key"
                        onClick={() => setRevokeConfirm(key.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Use your API key as a Bearer token:{" "}
        <code className="rounded bg-muted/30 px-1 py-0.5 font-mono text-xs">
          Authorization: Bearer gv_...
        </code>
      </p>
    </div>
  );
}
