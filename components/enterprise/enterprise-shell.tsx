"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Building2,
  ChevronLeft,
  CircleDollarSign,
  Database,
  DollarSign,
  LayoutDashboard,
  Map,
  Server,
  Settings,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanningTerritory } from "@/lib/types";

const sidebarNav = [
  { id: "overview", label: "Command Center", icon: LayoutDashboard },
  { id: "substations", label: "Substation Capacity", icon: Activity },
  { id: "transformers", label: "Transformer Overload", icon: Server },
  { id: "datacenters", label: "Data Center Queue", icon: Building2 },
  { id: "map", label: "Territory Map", icon: Map },
  { id: "forecast", label: "Load Forecast", icon: TrendingUp },
  { id: "copilot", label: "AI Copilot", icon: Sparkles },
  { id: "capital", label: "Capital Plan", icon: CircleDollarSign },
  { id: "assets",   label: "Assets",       icon: Database },
  { id: "accounts", label: "Accounts",           icon: Users       },
  { id: "revenue",  label: "Revenue Intelligence", icon: DollarSign  },
  { id: "admin",    label: "Administration",       icon: Shield      },
] as const;

export type EnterpriseSection = (typeof sidebarNav)[number]["id"];

interface EnterpriseShellProps {
  activeSection: EnterpriseSection;
  onSectionChange: (section: EnterpriseSection) => void;
  children: React.ReactNode;
  territory?: PlanningTerritory;
  badge?: React.ReactNode;
}

export function EnterpriseShell({
  activeSection,
  onSectionChange,
  children,
  territory,
  badge,
}: EnterpriseShellProps) {
  return (
    <div className="flex min-h-screen bg-[#070b12]">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/40 bg-[#0a0f18] lg:flex">
        <div className="border-b border-border/40 p-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">GridVision AI</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Planning Platform
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {sidebarNav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                activeSection === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-border/40 p-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Exit to Marketing Site
          </Link>
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50"
          >
            <Settings className="h-3.5 w-3.5" />
            Planning Assumptions
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/40 bg-[#0a0f18]/80 px-4 backdrop-blur-sm lg:px-6">
          <div className="flex items-center gap-4">
            {/* Mobile section selector */}
            <select
              className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs lg:hidden"
              value={activeSection}
              onChange={(e) =>
                onSectionChange(e.target.value as EnterpriseSection)
              }
            >
              {sidebarNav.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="hidden lg:block">
              <p className="text-sm font-medium">
                {territory?.operatingCompany ?? "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {territory
                  ? `${territory.name} · ${territory.planningHorizonYears}-Year Horizon`
                  : "Loading…"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            {/* Tenant switcher chip */}
            <TenantChip />

            <span className="hidden sm:inline">
              {territory && (
                <>
                  Model run:{" "}
                  {new Date(territory.lastModelRun).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </>
              )}
            </span>
            {badge ?? (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-slate-500" />
                Loading…
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

export { sidebarNav };

// ── Tenant switcher chip ──────────────────────────────────────────────────────
// Client-side component; reads the current tenant from a lightweight API call.
// Falls back to "GridVision Demo" when the database is not configured.

function TenantChip() {
  const [tenantName, setTenantName] = useState("GridVision Demo");

  useEffect(() => {
    fetch("/api/tenants")
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        const demo = (d.tenants as Array<{ name: string; slug: string }> | undefined)
          ?.find((t) => t.slug === "gridvision-demo");
        if (demo) setTenantName(demo.name);
      })
      .catch(() => {/* silently keep default */});
  }, []);

  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-border/40 bg-background/40 px-2.5 py-0.5 text-[10px] font-medium sm:flex">
      <Shield className="h-2.5 w-2.5 text-primary" />
      {tenantName}
    </span>
  );
}
