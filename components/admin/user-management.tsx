"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Users, X } from "lucide-react";
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
import { ROLE_LABELS, USER_ROLES } from "@/lib/auth/roles";
import type { DbUserWithRole, UserRole } from "@/lib/db/types";

// ── Role badge colors ─────────────────────────────────────────────────────────

const ROLE_BADGE: Record<UserRole, string> = {
  super_admin:       "bg-red-500/15     text-red-400     border-red-500/30",
  utility_executive: "bg-purple-500/15  text-purple-400  border-purple-500/30",
  planner:           "bg-blue-500/15    text-blue-400    border-blue-500/30",
  engineer:          "bg-cyan-500/15    text-cyan-400    border-cyan-500/30",
  sales:             "bg-orange-500/15  text-orange-400  border-orange-500/30",
  read_only:         "bg-slate-500/15   text-slate-400   border-slate-500/30",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function UserManagement() {
  const [users, setUsers]       = useState<DbUserWithRole[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    userId: "", email: "", fullName: "", role: "read_only" as UserRole,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const d = await res.json();
      setUsers(d.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleInvite() {
    setSaving(true); setFormError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId:   form.userId,
          email:    form.email,
          fullName: form.fullName || null,
          role:     form.role,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setInviting(false);
      setForm({ userId: "", email: "", fullName: "", role: "read_only" });
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setUpdatingId(userId);
    try {
      await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      await load();
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDeactivate(userId: string) {
    setUpdatingId(userId);
    try {
      await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      await load();
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle>User Management</CardTitle>
          </div>
          <CardDescription>
            {users.length} user{users.length !== 1 ? "s" : ""} in this tenant
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 border-border/40" onClick={load}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" className="h-7 gap-1.5" onClick={() => setInviting(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add User
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
            {error.includes("not configured")
              ? "Database not configured — run scripts/migrate-13a.sql to enable user management."
              : error}
          </div>
        )}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-3">
                      <p className="font-medium">{u.full_name ?? u.email}</p>
                      <p className="text-[10px] text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={u.role}
                        disabled={updatingId === u.id}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                        className="rounded border border-border/40 bg-background px-2 py-1 text-[10px]"
                      >
                        {USER_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={
                          u.is_active
                            ? "text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "text-[10px] bg-red-500/15 text-red-400 border-red-500/30"
                        }
                      >
                        {u.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {u.is_active && (
                        <button
                          onClick={() => handleDeactivate(u.id)}
                          disabled={updatingId === u.id}
                          className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No users yet. Add users to grant workspace access.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Role reference */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {USER_ROLES.map((r) => (
            <Badge key={r} variant="outline" className={`text-[9px] ${ROLE_BADGE[r]}`}>
              {ROLE_LABELS[r]}
            </Badge>
          ))}
        </div>

        {/* Invite modal */}
        {inviting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setInviting(false)} />
            <div className="relative z-10 w-full max-w-md rounded-lg border border-border/40 bg-[#0a0f18] p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">Add User</h2>
                <button onClick={() => setInviting(false)}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  The user must already exist in Supabase Auth. Enter their auth UUID to grant workspace access.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Auth UUID</Label>
                  <Input
                    value={form.userId}
                    onChange={(e) => setForm((p) => ({ ...p, userId: e.target.value }))}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="h-8 border-border/40 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="user@utility.com"
                    className="h-8 border-border/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Full Name (optional)</Label>
                  <Input
                    value={form.fullName}
                    onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                    placeholder="Jane Smith"
                    className="h-8 border-border/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Role</Label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as UserRole }))}
                    className="flex h-8 w-full rounded-md border border-border/40 bg-background px-2 text-sm"
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
                {formError && <p className="text-xs text-red-400">{formError}</p>}
                <div className="flex justify-end gap-2 border-t border-border/30 pt-3">
                  <Button variant="outline" size="sm" onClick={() => setInviting(false)} disabled={saving}>Cancel</Button>
                  <Button size="sm" onClick={handleInvite} disabled={saving || !form.userId || !form.email}>
                    {saving ? "Adding…" : "Add User"}
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
