"use client";

import { useEffect, useState } from "react";
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

// ── Types ──────────────────────────────────────────────────────────────────────

interface NotificationPreferences {
  emailOnDataStale?: boolean;
  emailOnProjectUpdate?: boolean;
  emailOnAccountUpdate?: boolean;
  emailOnHealthAlert?: boolean;
  emailOnCapacityWarning?: boolean;
  emailOnImportComplete?: boolean;
  slackWebhookUrl?: string;
  teamsWebhookUrl?: string;
}

interface SettingsFormState {
  companyName: string;
  timezone: string;
  defaultUnits: "metric" | "imperial";
  logoUrl: string;
  notificationEmail: string;
  notificationPreferences: NotificationPreferences;
}

const DEFAULT_SETTINGS: SettingsFormState = {
  companyName: "",
  timezone: "UTC",
  defaultUnits: "metric",
  logoUrl: "",
  notificationEmail: "",
  notificationPreferences: {
    emailOnDataStale: false,
    emailOnProjectUpdate: false,
    emailOnAccountUpdate: false,
    emailOnHealthAlert: false,
    emailOnCapacityWarning: false,
    emailOnImportComplete: false,
    slackWebhookUrl: "",
    teamsWebhookUrl: "",
  },
};

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
          checked ? "bg-primary" : "bg-border/60"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  return (
    <div
      className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
        type === "success"
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
          : "border-red-500/30 bg-red-500/15 text-red-400"
      }`}
    >
      {message}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsFormState>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [currentPlan, setCurrentPlan] = useState("Starter");
  const [testingChannel, setTestingChannel] = useState<"slack" | "teams" | null>(null);

  useEffect(() => {
    fetch("/api/tenants/settings")
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        const s = d.settings as Record<string, unknown>;
        const prefs = (s.notificationPreferences as NotificationPreferences) ?? {};
        setForm({
          companyName: (s.companyName as string) ?? "",
          timezone: (s.timezone as string) ?? "UTC",
          defaultUnits: ((s.defaultUnits as string) ?? "metric") as "metric" | "imperial",
          logoUrl: (s.logoUrl as string) ?? "",
          notificationEmail: (s.notificationEmail as string) ?? "",
          notificationPreferences: {
            emailOnDataStale: prefs.emailOnDataStale ?? false,
            emailOnProjectUpdate: prefs.emailOnProjectUpdate ?? false,
            emailOnAccountUpdate: prefs.emailOnAccountUpdate ?? false,
            emailOnHealthAlert: prefs.emailOnHealthAlert ?? false,
            emailOnCapacityWarning: prefs.emailOnCapacityWarning ?? false,
            emailOnImportComplete: prefs.emailOnImportComplete ?? false,
            slackWebhookUrl: prefs.slackWebhookUrl ?? "",
            teamsWebhookUrl: prefs.teamsWebhookUrl ?? "",
          },
        });
        if (d.plan) setCurrentPlan(d.plan as string);
      })
      .catch(() => {/* keep defaults */})
      .finally(() => setLoading(false));
  }, []);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/tenants/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName || undefined,
          timezone: form.timezone,
          defaultUnits: form.defaultUnits,
          logoUrl: form.logoUrl || undefined,
          notificationEmail: form.notificationEmail || undefined,
          notificationPreferences: form.notificationPreferences,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error((d as { error?: string }).error ?? "Save failed");
      }
      showToast("Settings saved successfully.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNotification(channel: "slack" | "teams") {
    setTestingChannel(channel);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        showToast(`Test ${channel} notification sent successfully.`, "success");
      } else {
        showToast(d.error ?? `${channel} test failed.`, "error");
      }
    } catch {
      showToast(`Failed to send ${channel} test.`, "error");
    } finally {
      setTestingChannel(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-lg border border-border/40 bg-[#0d1219]/80" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization profile and notification preferences.
        </p>
      </div>

      {/* Section 1 — Company Profile */}
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-base">Company Profile</CardTitle>
          <CardDescription>
            Basic information about your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company Name</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              placeholder="Acme Utility Co."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <select
              id="timezone"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York (Eastern)</option>
              <option value="America/Chicago">America/Chicago (Central)</option>
              <option value="America/Denver">America/Denver (Mountain)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="defaultUnits">Default Units</Label>
            <select
              id="defaultUnits"
              value={form.defaultUnits}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultUnits: e.target.value as "metric" | "imperial",
                }))
              }
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="metric">Metric (MW, MVA, km)</option>
              <option value="imperial">Imperial (MW, MVA, miles)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              type="url"
              value={form.logoUrl}
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
              placeholder="https://example.com/logo.png"
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Notification Preferences */}
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
          <CardDescription>Configure how you receive alerts and updates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="notificationEmail">Notification Email</Label>
            <Input
              id="notificationEmail"
              type="email"
              value={form.notificationEmail}
              onChange={(e) =>
                setForm((f) => ({ ...f, notificationEmail: e.target.value }))
              }
              placeholder="ops@utility.com"
            />
          </div>

          <div className="space-y-3 pt-1">
            <Toggle
              label="Email when data becomes stale"
              checked={!!form.notificationPreferences.emailOnDataStale}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notificationPreferences: {
                    ...f.notificationPreferences,
                    emailOnDataStale: v,
                  },
                }))
              }
            />
            <Toggle
              label="Email on project updates"
              checked={!!form.notificationPreferences.emailOnProjectUpdate}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notificationPreferences: {
                    ...f.notificationPreferences,
                    emailOnProjectUpdate: v,
                  },
                }))
              }
            />
            <Toggle
              label="Email on account updates"
              checked={!!form.notificationPreferences.emailOnAccountUpdate}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notificationPreferences: {
                    ...f.notificationPreferences,
                    emailOnAccountUpdate: v,
                  },
                }))
              }
            />
            <Toggle
              label="Email on grid health alerts"
              checked={!!form.notificationPreferences.emailOnHealthAlert}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notificationPreferences: {
                    ...f.notificationPreferences,
                    emailOnHealthAlert: v,
                  },
                }))
              }
            />
            <Toggle
              label="Email on capacity warnings"
              checked={!!form.notificationPreferences.emailOnCapacityWarning}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notificationPreferences: {
                    ...f.notificationPreferences,
                    emailOnCapacityWarning: v,
                  },
                }))
              }
            />
            <Toggle
              label="Email on import complete"
              checked={!!form.notificationPreferences.emailOnImportComplete}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  notificationPreferences: {
                    ...f.notificationPreferences,
                    emailOnImportComplete: v,
                  },
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slackWebhook">Slack Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                id="slackWebhook"
                type="url"
                value={form.notificationPreferences.slackWebhookUrl ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    notificationPreferences: {
                      ...f.notificationPreferences,
                      slackWebhookUrl: e.target.value,
                    },
                  }))
                }
                placeholder="https://hooks.slack.com/services/..."
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !form.notificationPreferences.slackWebhookUrl ||
                  testingChannel === "slack"
                }
                onClick={() => void handleTestNotification("slack")}
              >
                {testingChannel === "slack" ? "Sending..." : "Test"}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="teamsWebhook">Microsoft Teams Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                id="teamsWebhook"
                type="url"
                value={form.notificationPreferences.teamsWebhookUrl ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    notificationPreferences: {
                      ...f.notificationPreferences,
                      teamsWebhookUrl: e.target.value,
                    },
                  }))
                }
                placeholder="https://outlook.office.com/webhook/..."
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !form.notificationPreferences.teamsWebhookUrl ||
                  testingChannel === "teams"
                }
                onClick={() => void handleTestNotification("teams")}
              >
                {testingChannel === "teams" ? "Sending..." : "Test"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Plan & Billing (read-only) */}
      <Card className="border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle className="text-base">Plan & Billing</CardTitle>
          <CardDescription>Your current subscription details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">Current Plan</span>
            <span className="text-sm font-medium">{currentPlan}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">Subscription Status</span>
            <span className="text-sm font-medium text-emerald-400">Active</span>
          </div>
          <p className="text-xs text-muted-foreground">
            To upgrade or manage billing, contact{" "}
            <a href="mailto:billing@gridvision.ai" className="text-primary hover:underline">
              billing@gridvision.ai
            </a>
            .
          </p>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
