"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Plus, RefreshCw, Shield, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { DbTenant, TenantStatus } from "@/lib/db/types";

// ── Display helpers ───────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TenantStatus, string> = {
  active:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  suspended: "bg-yellow-500/15  text-yellow-400  border-yellow-500/30",
  cancelled: "bg-red-500/15     text-red-400     border-red-500/30",
};

const PLAN_BADGE: Record<string, string> = {
  trial:        "bg-slate-500/15  text-slate-400  border-slate-500/30",
  professional: "bg-blue-500/15   text-blue-400   border-blue-500/30",
  enterprise:   "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

const TYPE_LABEL: Record<string, string> = {
  utility:    "Utility",
  developer:  "DC Developer",
  consultant: "Consultant",
  investor:   "Investor",
  demo:       "Demo",
};

type TenantWithCount = DbTenant & { userCount?: number };

// ── Component ─────────────────────────────────────────────────────────────────

export function TenantManagement() {
  const [tenants, setTenants]   = useState<TenantWithCount[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", slug: "", type: "utility", plan: "trial", status: "active",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tenants");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const d = await res.json();
      setTenants(d.tenants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/tenants", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setCreating(false);
      setForm({ name: "", slug: "", type: "utility", plan: "trial", status: "active" });
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const f = (k: string) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle>Tenant Management</CardTitle>
          </div>
          <CardDescription>
            {tenants.length} tenant{tenants.length !== 1 ? "s" : ""} · Super Admin only
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 border-border/40" onClick={load}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" className="h-7 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Tenant
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {loading && (
          <div className="space-y-2 animate-pulse">
            {[1,2,3].map((i) => <div key={i} className="h-12 rounded bg-border/20" />)}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            {error.includes("Forbidden") ? (
              "Access restricted to Super Admins. Sign in with an admin account to manage tenants."
            ) : error.includes("not configured") ? (
              "Database not configured — run scripts/migrate-13a.sql to enable tenant management."
            ) : error}
          </div>
        )}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">Tenant</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Users</th>
                  <th className="px-3 py-2 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-3">
                      <p className="font-medium">{t.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{t.slug}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{TYPE_LABEL[t.type] ?? t.type}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={`text-[10px] ${PLAN_BADGE[t.plan] ?? ""}`}>
                        {t.plan}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[t.status]}`}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground">
                      {t.userCount ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-[10px] text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No tenants yet. Create your first tenant to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Create modal */}
        {creating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setCreating(false)} />
            <div className="relative z-10 w-full max-w-md rounded-lg border border-border/40 bg-[#0a0f18] p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">Create Tenant</h2>
                <button onClick={() => setCreating(false)}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={form.name} onChange={(e) => f("name")(e.target.value)} placeholder="Eversource Energy" className="h-8 border-border/40" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Slug (URL-safe identifier)</Label>
                  <Input value={form.slug} onChange={(e) => f("slug")(e.target.value)} placeholder="eversource" className="h-8 border-border/40 font-mono" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <select value={form.type} onChange={(e) => f("type")(e.target.value)} className="flex h-8 w-full rounded-md border border-border/40 bg-background px-2 text-xs">
                      <option value="utility">Utility</option>
                      <option value="developer">DC Developer</option>
                      <option value="consultant">Consultant</option>
                      <option value="investor">Investor</option>
                      <option value="demo">Demo</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Plan</Label>
                    <select value={form.plan} onChange={(e) => f("plan")(e.target.value)} className="flex h-8 w-full rounded-md border border-border/40 bg-background px-2 text-xs">
                      <option value="trial">Trial</option>
                      <option value="professional">Professional</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <select value={form.status} onChange={(e) => f("status")(e.target.value)} className="flex h-8 w-full rounded-md border border-border/40 bg-background px-2 text-xs">
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>
                {formError && <p className="text-xs text-red-400">{formError}</p>}
                <div className="flex justify-end gap-2 border-t border-border/30 pt-3">
                  <Button variant="outline" size="sm" onClick={() => setCreating(false)} disabled={saving}>Cancel</Button>
                  <Button size="sm" onClick={handleCreate} disabled={saving || !form.name || !form.slug}>
                    {saving ? "Creating…" : "Create Tenant"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
