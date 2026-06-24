"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronDown, ChevronUp, ChevronsUpDown,
  Edit2, ExternalLink, Layers, Plus, Search, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  useManagedSubstations, useManagedTransformers,
  useManagedFeeders, useManagedCapitalProjects,
  type ManagedSubstation, type ManagedTransformer,
  type ManagedFeeder, type ManagedCapitalProject,
} from "@/lib/hooks/use-assets";

// ── Tab types ─────────────────────────────────────────────────────────────────

type AssetTab = "substations" | "transformers" | "feeders" | "capital-projects";

const TABS: { id: AssetTab; label: string }[] = [
  { id: "substations",      label: "Substations" },
  { id: "transformers",     label: "Transformers" },
  { id: "feeders",          label: "Feeders" },
  { id: "capital-projects", label: "Capital Projects" },
];

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({
  label, children, error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

function FormInput(props: React.ComponentProps<typeof Input>) {
  return (
    <Input
      {...props}
      className="h-8 border-border/40 bg-background/50 text-sm"
    />
  );
}

function FormSelect({
  value, onChange, children, ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      value={value}
      onChange={onChange}
      {...rest}
      className="flex h-8 w-full rounded-md border border-border/40 bg-background/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {children}
    </select>
  );
}

// ── Modal overlay ─────────────────────────────────────────────────────────────

function Modal({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border/40 bg-[#0a0f18] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Confirm delete dialog ─────────────────────────────────────────────────────

function ConfirmDelete({
  name, onConfirm, onCancel, loading,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <Modal title="Confirm Delete" onClose={onCancel}>
      <p className="mb-6 text-sm text-muted-foreground">
        Are you sure you want to delete <span className="font-semibold text-foreground">{name}</span>?
        This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm} disabled={loading}>
          {loading ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Modal>
  );
}

// ── Sort helper ───────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function SortIcon({ field, active, dir }: { field: string; active: string; dir: SortDir }) {
  if (field !== active) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="ml-1 inline h-3 w-3 text-primary" />
    : <ChevronDown className="ml-1 inline h-3 w-3 text-primary" />;
}

function useSortSearch<T extends Record<string, unknown>>(
  items: T[],
  defaultSort: keyof T
) {
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<keyof T>(defaultSort);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(field: keyof T) {
    if (field === sortField) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const searched = q
      ? items.filter((item) =>
          Object.values(item).some((v) =>
            String(v).toLowerCase().includes(q)
          )
        )
      : items;

    return [...searched].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, query, sortField, sortDir]);

  return { query, setQuery, sortField, sortDir, toggleSort, filtered };
}

// ── Th helper ─────────────────────────────────────────────────────────────────

function Th({
  label, field, sortField, sortDir, onClick,
}: {
  label: string;
  field: string;
  sortField: string;
  sortDir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground"
      onClick={onClick}
    >
      {label}
      <SortIcon field={field} active={sortField} dir={sortDir} />
    </th>
  );
}

// ── Timestamp row ─────────────────────────────────────────────────────────────

function TimestampRow({ createdAt, updatedAt }: { createdAt: string; updatedAt: string }) {
  const fmt = (s: string) =>
    new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="mt-4 space-y-1 border-t border-border/30 pt-3 text-[10px] text-muted-foreground">
      <p>Created: {fmt(createdAt)}</p>
      <p>Updated: {fmt(updatedAt)}</p>
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-border/40 bg-[#0a0f18] shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <p className="text-sm font-semibold">Asset Details</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {children}
        </div>
      </div>
    </>
  );
}

function DrawerRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  );
}

// ── Loading / Error states ────────────────────────────────────────────────────

function AssetSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded bg-border/20" />
      ))}
    </div>
  );
}

function AssetError({ message }: { message: string }) {
  return (
    <p className="text-sm text-red-400">
      {message.includes("Database not configured")
        ? "Database not configured — run scripts/migrate-11a.sql to enable asset management."
        : message}
    </p>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBSTATION TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SubstationsTab() {
  const { items, loading, error, create, update, remove } = useManagedSubstations();
  const { query, setQuery, sortField, sortDir, toggleSort, filtered } =
    useSortSearch(items as unknown as Record<string, unknown>[], "name");

  const [drawer, setDrawer] = useState<ManagedSubstation | null>(null);
  const [editing, setEditing] = useState<ManagedSubstation | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ManagedSubstation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const ss = filtered as unknown as ManagedSubstation[];

  function blankForm() {
    return {
      id: "", name: "", region: "", voltageKV: 115, nameplateMVA: 0,
      peakLoadMW: 0, n1CapacityMW: 0, annualGrowthPct: 0, latitude: 0, longitude: 0,
    };
  }
  const [form, setForm] = useState(blankForm());
  const f = (k: string) => (v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  function openCreate() { setForm(blankForm()); setFormError(null); setCreating(true); }
  function openEdit(s: ManagedSubstation) {
    setForm({
      id: s.id, name: s.name, region: s.region, voltageKV: s.voltageKV,
      nameplateMVA: s.nameplateMVA, peakLoadMW: s.peakLoadMW, n1CapacityMW: s.n1CapacityMW,
      annualGrowthPct: s.annualGrowthPct, latitude: s.latitude, longitude: s.longitude,
    });
    setFormError(null); setEditing(s);
  }

  async function handleSubmit() {
    setSaving(true); setFormError(null);
    const res = editing
      ? await update(editing.id, { ...form })
      : await create({ ...form });
    setSaving(false);
    if (!res.ok) { setFormError(res.error ?? "Save failed"); return; }
    setCreating(false); setEditing(null);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await remove(deleting.id);
    setDeleteLoading(false);
    if (!res.ok) { setFormError(res.error ?? "Delete failed"); }
    setDeleting(null); setDrawer(null);
  }

  return (
    <>
      <TabToolbar query={query} onQuery={setQuery} onCreate={openCreate} label="Substation" />
      {loading && <AssetSkeleton />}
      {!loading && error && <AssetError message={error} />}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border/30 bg-background/20">
                <Th label="Name"     field="name"          sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("name")} />
                <Th label="Region"   field="region"        sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("region")} />
                <Th label="kV"       field="voltageKV"     sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("voltageKV")} />
                <Th label="MVA"      field="nameplateMVA"  sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("nameplateMVA")} />
                <Th label="Peak MW"  field="peakLoadMW"    sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("peakLoadMW")} />
                <Th label="N-1 MW"   field="n1CapacityMW"  sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("n1CapacityMW")} />
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {ss.map((s) => {
                const util = s.nameplateMVA > 0 ? (s.peakLoadMW / s.nameplateMVA) * 100 : 0;
                return (
                  <tr key={s.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDrawer(s)}>
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.region}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.voltageKV}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.nameplateMVA}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.peakLoadMW}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs ${util >= 95 ? "text-red-400" : util >= 85 ? "text-orange-400" : util >= 75 ? "text-yellow-400" : "text-emerald-400"}`}>
                        {util.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions onEdit={() => openEdit(s)} onDelete={() => setDeleting(s)} openHref={`/enterprise/assets/substations/${s.id}`} />
                    </td>
                  </tr>
                );
              })}
              {ss.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No substations found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer */}
      {drawer && (
        <Drawer onClose={() => setDrawer(null)}>
          <div className="space-y-2.5">
            <p className="text-base font-semibold">{drawer.name}</p>
            <DrawerRow label="ID" value={drawer.id} />
            <DrawerRow label="Region" value={drawer.region} />
            <DrawerRow label="Voltage" value={`${drawer.voltageKV} kV`} />
            <DrawerRow label="Nameplate" value={`${drawer.nameplateMVA} MVA`} />
            <DrawerRow label="Peak Load" value={`${drawer.peakLoadMW} MW`} />
            <DrawerRow label="N-1 Capacity" value={`${drawer.n1CapacityMW} MW`} />
            <DrawerRow label="Utilization" value={`${((drawer.peakLoadMW / drawer.nameplateMVA) * 100).toFixed(1)}%`} />
            <DrawerRow label="Annual Growth" value={`${drawer.annualGrowthPct}%/yr`} />
            <DrawerRow label="Coordinates" value={`${drawer.latitude.toFixed(4)}°N, ${Math.abs(drawer.longitude).toFixed(4)}°W`} />
            <div className="pt-1">
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Transformers ({drawer.transformers.length})</p>
              {drawer.transformers.map((t) => (
                <p key={t.id} className="text-xs text-muted-foreground">· {t.name} — {t.ratedMVA} MVA</p>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Feeders ({drawer.feeders.length})</p>
              {drawer.feeders.map((f) => (
                <p key={f.id} className="text-xs text-muted-foreground">· {f.name}</p>
              ))}
            </div>
            <TimestampRow createdAt={drawer.createdAt} updatedAt={drawer.updatedAt} />
          </div>
        </Drawer>
      )}

      {/* Form modal */}
      {(creating || editing) && (
        <Modal title={editing ? "Edit Substation" : "New Substation"} onClose={() => { setCreating(false); setEditing(null); }}>
          <div className="space-y-3">
            {!editing && (
              <Field label="ID (e.g. ss-boston-south)">
                <FormInput value={form.id} onChange={(e) => f("id")(e.target.value)} placeholder="ss-example" />
              </Field>
            )}
            <Field label="Name"><FormInput value={form.name} onChange={(e) => f("name")(e.target.value)} /></Field>
            <Field label="Region"><FormInput value={form.region} onChange={(e) => f("region")(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Voltage (kV)"><FormInput type="number" value={form.voltageKV} onChange={(e) => f("voltageKV")(Number(e.target.value))} /></Field>
              <Field label="Nameplate (MVA)"><FormInput type="number" value={form.nameplateMVA} onChange={(e) => f("nameplateMVA")(Number(e.target.value))} /></Field>
              <Field label="Peak Load (MW)"><FormInput type="number" value={form.peakLoadMW} onChange={(e) => f("peakLoadMW")(Number(e.target.value))} /></Field>
              <Field label="N-1 Capacity (MW)"><FormInput type="number" value={form.n1CapacityMW} onChange={(e) => f("n1CapacityMW")(Number(e.target.value))} /></Field>
              <Field label="Growth (%/yr)"><FormInput type="number" step="0.1" value={form.annualGrowthPct} onChange={(e) => f("annualGrowthPct")(Number(e.target.value))} /></Field>
              <Field label="Latitude"><FormInput type="number" step="0.0001" value={form.latitude} onChange={(e) => f("latitude")(Number(e.target.value))} /></Field>
            </div>
            <Field label="Longitude"><FormInput type="number" step="0.0001" value={form.longitude} onChange={(e) => f("longitude")(Number(e.target.value))} /></Field>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <FormActions onCancel={() => { setCreating(false); setEditing(null); }} onSave={handleSubmit} saving={saving} />
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <ConfirmDelete
          name={deleting.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
          loading={deleteLoading}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORMERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function TransformersTab() {
  const { items, loading, error, create, update, remove } = useManagedTransformers();
  const { items: substations } = useManagedSubstations();
  const { query, setQuery, sortField, sortDir, toggleSort, filtered } =
    useSortSearch(items as unknown as Record<string, unknown>[], "name");

  const [drawer, setDrawer] = useState<ManagedTransformer | null>(null);
  const [editing, setEditing] = useState<ManagedTransformer | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ManagedTransformer | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const txs = filtered as unknown as ManagedTransformer[];

  function blankForm() {
    return { id: "", substationId: substations[0]?.id ?? "", name: "", ratedMVA: 0, peakLoadMVA: 0, loadFactor: 0.9, ageYears: 0, n1Compliant: true };
  }
  const [form, setForm] = useState(blankForm());
  const f = (k: string) => (v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  function openEdit(t: ManagedTransformer) {
    setForm({ id: t.id, substationId: t.substationId, name: t.name, ratedMVA: t.ratedMVA, peakLoadMVA: t.peakLoadMVA, loadFactor: t.loadFactor, ageYears: t.ageYears, n1Compliant: t.n1Compliant });
    setFormError(null); setEditing(t);
  }

  async function handleSubmit() {
    setSaving(true); setFormError(null);
    const res = editing ? await update(editing.id, form) : await create(form);
    setSaving(false);
    if (!res.ok) { setFormError(res.error ?? "Save failed"); return; }
    setCreating(false); setEditing(null);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await remove(deleting.id);
    setDeleteLoading(false);
    if (!res.ok) setFormError(res.error ?? "Delete failed");
    setDeleting(null); setDrawer(null);
  }

  const ssName = (id: string) => substations.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <TabToolbar query={query} onQuery={setQuery} onCreate={() => { setForm(blankForm()); setFormError(null); setCreating(true); }} label="Transformer" />
      {loading && <AssetSkeleton />}
      {!loading && error && <AssetError message={error} />}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border/30 bg-background/20">
                <Th label="Name"       field="name"         sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("name")} />
                <Th label="Substation" field="substationId" sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("substationId")} />
                <Th label="Rated MVA"  field="ratedMVA"     sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("ratedMVA")} />
                <Th label="Loading %"  field="peakLoadMVA"  sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("peakLoadMVA")} />
                <Th label="Age"        field="ageYears"     sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("ageYears")} />
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">N-1</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {txs.map((t) => {
                const pct = t.ratedMVA > 0 ? (t.peakLoadMVA / t.ratedMVA) * 100 : 0;
                return (
                  <tr key={t.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDrawer(t)}>
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{ssName(t.substationId).split(" ").slice(0, 2).join(" ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{t.ratedMVA}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs ${pct >= 95 ? "text-red-400" : pct >= 80 ? "text-orange-400" : "text-emerald-400"}`}>
                        {pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{t.ageYears} yr</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={t.n1Compliant ? "border-emerald-500/30 text-emerald-400 text-[10px]" : "border-red-500/30 text-red-400 text-[10px]"}>
                        {t.n1Compliant ? "Yes" : "No"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions onEdit={() => openEdit(t)} onDelete={() => setDeleting(t)} openHref={`/enterprise/assets/transformers/${t.id}`} />
                    </td>
                  </tr>
                );
              })}
              {txs.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No transformers found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {drawer && (
        <Drawer onClose={() => setDrawer(null)}>
          <p className="text-base font-semibold">{drawer.name}</p>
          <DrawerRow label="Substation" value={ssName(drawer.substationId)} />
          <DrawerRow label="Rated" value={`${drawer.ratedMVA} MVA`} />
          <DrawerRow label="Peak Load" value={`${drawer.peakLoadMVA} MVA`} />
          <DrawerRow label="Loading" value={`${((drawer.peakLoadMVA / drawer.ratedMVA) * 100).toFixed(1)}%`} />
          <DrawerRow label="Load Factor" value={drawer.loadFactor.toFixed(2)} />
          <DrawerRow label="Age" value={`${drawer.ageYears} years`} />
          <DrawerRow label="N-1 Compliant" value={drawer.n1Compliant ? "Yes" : "No"} />
          <TimestampRow createdAt={drawer.createdAt} updatedAt={drawer.updatedAt} />
        </Drawer>
      )}

      {(creating || editing) && (
        <Modal title={editing ? "Edit Transformer" : "New Transformer"} onClose={() => { setCreating(false); setEditing(null); }}>
          <div className="space-y-3">
            {!editing && <Field label="ID"><FormInput value={form.id} onChange={(e) => f("id")(e.target.value)} placeholder="tx-example" /></Field>}
            <Field label="Substation">
              <FormSelect value={form.substationId} onChange={(e) => f("substationId")(e.target.value)}>
                {substations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </FormSelect>
            </Field>
            <Field label="Name"><FormInput value={form.name} onChange={(e) => f("name")(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rated MVA"><FormInput type="number" value={form.ratedMVA} onChange={(e) => f("ratedMVA")(Number(e.target.value))} /></Field>
              <Field label="Peak Load MVA"><FormInput type="number" value={form.peakLoadMVA} onChange={(e) => f("peakLoadMVA")(Number(e.target.value))} /></Field>
              <Field label="Load Factor (0–1)"><FormInput type="number" step="0.01" min="0" max="1" value={form.loadFactor} onChange={(e) => f("loadFactor")(Number(e.target.value))} /></Field>
              <Field label="Age (years)"><FormInput type="number" value={form.ageYears} onChange={(e) => f("ageYears")(Number(e.target.value))} /></Field>
            </div>
            <Field label="N-1 Compliant">
              <FormSelect value={String(form.n1Compliant)} onChange={(e) => f("n1Compliant")(e.target.value === "true")}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </FormSelect>
            </Field>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <FormActions onCancel={() => { setCreating(false); setEditing(null); }} onSave={handleSubmit} saving={saving} />
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDelete name={deleting.name} onConfirm={handleDelete} onCancel={() => setDeleting(null)} loading={deleteLoading} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function FeedersTab() {
  const { items, loading, error, create, update, remove } = useManagedFeeders();
  const { items: substations } = useManagedSubstations();
  const { query, setQuery, sortField, sortDir, toggleSort, filtered } =
    useSortSearch(items as unknown as Record<string, unknown>[], "name");

  const [drawer, setDrawer] = useState<ManagedFeeder | null>(null);
  const [editing, setEditing] = useState<ManagedFeeder | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ManagedFeeder | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const feeders = filtered as unknown as ManagedFeeder[];

  function blankForm() {
    return { id: "", substationId: substations[0]?.id ?? "", name: "", hostingCapacityMW: 0, committedLoadMW: 0, queuedLoadMW: 0 };
  }
  const [form, setForm] = useState(blankForm());
  const f = (k: string) => (v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  function openEdit(fd: ManagedFeeder) {
    setForm({ id: fd.id, substationId: fd.substationId, name: fd.name, hostingCapacityMW: fd.hostingCapacityMW, committedLoadMW: fd.committedLoadMW, queuedLoadMW: fd.queuedLoadMW });
    setFormError(null); setEditing(fd);
  }

  async function handleSubmit() {
    setSaving(true); setFormError(null);
    const res = editing ? await update(editing.id, form) : await create(form);
    setSaving(false);
    if (!res.ok) { setFormError(res.error ?? "Save failed"); return; }
    setCreating(false); setEditing(null);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await remove(deleting.id);
    setDeleteLoading(false);
    if (!res.ok) setFormError(res.error ?? "Delete failed");
    setDeleting(null); setDrawer(null);
  }

  const ssName = (id: string) => substations.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <TabToolbar query={query} onQuery={setQuery} onCreate={() => { setForm(blankForm()); setFormError(null); setCreating(true); }} label="Feeder" />
      {loading && <AssetSkeleton />}
      {!loading && error && <AssetError message={error} />}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/30 bg-background/20">
                <Th label="Name"       field="name"              sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("name")} />
                <Th label="Substation" field="substationId"      sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("substationId")} />
                <Th label="Hosting MW" field="hostingCapacityMW" sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("hostingCapacityMW")} />
                <Th label="Committed"  field="committedLoadMW"   sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("committedLoadMW")} />
                <Th label="Queued"     field="queuedLoadMW"      sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("queuedLoadMW")} />
                <Th label="Headroom"   field="hostingCapacityMW" sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("hostingCapacityMW")} />
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {feeders.map((fd) => {
                const headroom = fd.hostingCapacityMW - fd.committedLoadMW - fd.queuedLoadMW;
                return (
                  <tr key={fd.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDrawer(fd)}>
                    <td className="px-4 py-3 font-medium">{fd.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{ssName(fd.substationId).split(" ").slice(0, 2).join(" ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{fd.hostingCapacityMW}</td>
                    <td className="px-4 py-3 font-mono text-xs">{fd.committedLoadMW}</td>
                    <td className="px-4 py-3 font-mono text-xs">{fd.queuedLoadMW}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs ${headroom < 0 ? "text-red-400" : headroom < 5 ? "text-orange-400" : "text-emerald-400"}`}>
                        {headroom.toFixed(0)} MW
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions onEdit={() => openEdit(fd)} onDelete={() => setDeleting(fd)} openHref={`/enterprise/assets/feeders/${fd.id}`} />
                    </td>
                  </tr>
                );
              })}
              {feeders.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No feeders found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {drawer && (
        <Drawer onClose={() => setDrawer(null)}>
          <p className="text-base font-semibold">{drawer.name}</p>
          <DrawerRow label="Substation" value={ssName(drawer.substationId)} />
          <DrawerRow label="Hosting Capacity" value={`${drawer.hostingCapacityMW} MW`} />
          <DrawerRow label="Committed Load" value={`${drawer.committedLoadMW} MW`} />
          <DrawerRow label="Queued Load" value={`${drawer.queuedLoadMW} MW`} />
          <DrawerRow label="Available Headroom" value={`${(drawer.hostingCapacityMW - drawer.committedLoadMW - drawer.queuedLoadMW).toFixed(0)} MW`} />
          <TimestampRow createdAt={drawer.createdAt} updatedAt={drawer.updatedAt} />
        </Drawer>
      )}

      {(creating || editing) && (
        <Modal title={editing ? "Edit Feeder" : "New Feeder"} onClose={() => { setCreating(false); setEditing(null); }}>
          <div className="space-y-3">
            {!editing && <Field label="ID"><FormInput value={form.id} onChange={(e) => f("id")(e.target.value)} placeholder="fd-example" /></Field>}
            <Field label="Substation">
              <FormSelect value={form.substationId} onChange={(e) => f("substationId")(e.target.value)}>
                {substations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </FormSelect>
            </Field>
            <Field label="Name"><FormInput value={form.name} onChange={(e) => f("name")(e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Hosting MW"><FormInput type="number" value={form.hostingCapacityMW} onChange={(e) => f("hostingCapacityMW")(Number(e.target.value))} /></Field>
              <Field label="Committed MW"><FormInput type="number" value={form.committedLoadMW} onChange={(e) => f("committedLoadMW")(Number(e.target.value))} /></Field>
              <Field label="Queued MW"><FormInput type="number" value={form.queuedLoadMW} onChange={(e) => f("queuedLoadMW")(Number(e.target.value))} /></Field>
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <FormActions onCancel={() => { setCreating(false); setEditing(null); }} onSave={handleSubmit} saving={saving} />
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDelete name={deleting.name} onConfirm={handleDelete} onCancel={() => setDeleting(null)} loading={deleteLoading} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPITAL PROJECTS TAB
// ═══════════════════════════════════════════════════════════════════════════════

const UPGRADE_TYPES = ["transformer-replacement","substation-expansion","feeder-reconductor","new-substation","cable-replacement"] as const;
const PROJECT_STATUSES = ["planned","approved","in-progress","completed","cancelled"] as const;

const STATUS_BADGE: Record<string, string> = {
  planned:      "bg-slate-500/15 text-slate-400 border-slate-500/30",
  approved:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "in-progress":"bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  completed:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  cancelled:    "bg-red-500/15 text-red-400 border-red-500/30",
};

function CapitalProjectsTab() {
  const { items, loading, error, create, update, remove } = useManagedCapitalProjects();
  const { items: substations } = useManagedSubstations();
  const { query, setQuery, sortField, sortDir, toggleSort, filtered } =
    useSortSearch(items as unknown as Record<string, unknown>[], "priorityScore");

  const [drawer, setDrawer] = useState<ManagedCapitalProject | null>(null);
  const [editing, setEditing] = useState<ManagedCapitalProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ManagedCapitalProject | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const projects = filtered as unknown as ManagedCapitalProject[];

  type CPForm = {
    id: string; substationId: string; projectName: string;
    upgradeType: typeof UPGRADE_TYPES[number];
    estimatedCostUSD: number; addedCapacityMW: number; implementationMonths: number;
    riskReduction: number; priorityScore: number;
    status: typeof PROJECT_STATUSES[number]; notes: string;
  };
  function blankForm(): CPForm {
    return { id: "", substationId: substations[0]?.id ?? "", projectName: "", upgradeType: "transformer-replacement", estimatedCostUSD: 0, addedCapacityMW: 0, implementationMonths: 12, riskReduction: 0, priorityScore: 50, status: "planned", notes: "" };
  }
  const [form, setForm] = useState<CPForm>(blankForm());
  const f = (k: string) => (v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  function openEdit(p: ManagedCapitalProject) {
    setForm({ id: p.id, substationId: p.substationId, projectName: p.projectName, upgradeType: p.upgradeType, estimatedCostUSD: p.estimatedCostUSD, addedCapacityMW: p.addedCapacityMW, implementationMonths: p.implementationMonths, riskReduction: p.riskReduction, priorityScore: p.priorityScore, status: p.status, notes: "" });
    setFormError(null); setEditing(p);
  }

  async function handleSubmit() {
    setSaving(true); setFormError(null);
    const res = editing ? await update(editing.id, form) : await create(form);
    setSaving(false);
    if (!res.ok) { setFormError(res.error ?? "Save failed"); return; }
    setCreating(false); setEditing(null);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await remove(deleting.id);
    setDeleteLoading(false);
    if (!res.ok) setFormError(res.error ?? "Delete failed");
    setDeleting(null); setDrawer(null);
  }

  const ssName = (id: string) => substations.find((s) => s.id === id)?.name ?? id;
  const fmtCost = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

  return (
    <>
      <TabToolbar query={query} onQuery={setQuery} onCreate={() => { setForm(blankForm()); setFormError(null); setCreating(true); }} label="Project" />
      {loading && <AssetSkeleton />}
      {!loading && error && <AssetError message={error} />}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border/30 bg-background/20">
                <Th label="Project"      field="projectName"    sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("projectName")} />
                <Th label="Cost"         field="estimatedCostUSD" sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("estimatedCostUSD")} />
                <Th label="Added MW"     field="addedCapacityMW"  sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("addedCapacityMW")} />
                <Th label="Months"       field="implementationMonths" sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("implementationMonths")} />
                <Th label="Priority"     field="priorityScore"  sortField={String(sortField)} sortDir={sortDir} onClick={() => toggleSort("priorityScore")} />
                <th className="px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {projects.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDrawer(p)}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.projectName}</p>
                    <p className="text-[10px] text-muted-foreground">{ssName(p.substationId).split(" ").slice(0, 2).join(" ")}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{fmtCost(p.estimatedCostUSD)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-400">+{p.addedCapacityMW} MW</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.implementationMonths} mo</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-12 overflow-hidden rounded-full bg-border/40">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${p.priorityScore}%` }} />
                      </div>
                      <span className="font-mono text-xs">{p.priorityScore}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[p.status] ?? ""}`}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions onEdit={() => openEdit(p)} onDelete={() => setDeleting(p)} openHref={`/enterprise/assets/projects/${p.id}`} />
                  </td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No capital projects found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {drawer && (
        <Drawer onClose={() => setDrawer(null)}>
          <p className="text-base font-semibold">{drawer.projectName}</p>
          <DrawerRow label="Substation" value={ssName(drawer.substationId)} />
          <DrawerRow label="Type" value={drawer.upgradeType} />
          <DrawerRow label="Cost" value={fmtCost(drawer.estimatedCostUSD)} />
          <DrawerRow label="Added Capacity" value={`${drawer.addedCapacityMW} MW`} />
          <DrawerRow label="Cost / MW" value={`$${Math.round(drawer.estimatedCostUSD / drawer.addedCapacityMW / 1000).toLocaleString()}k`} />
          <DrawerRow label="Timeline" value={`${drawer.implementationMonths} months`} />
          <DrawerRow label="Risk Reduction" value={`${drawer.riskReduction}/100`} />
          <DrawerRow label="Priority Score" value={`${drawer.priorityScore}/100`} />
          <DrawerRow label="Status" value={<Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[drawer.status]}`}>{drawer.status}</Badge>} />
          <TimestampRow createdAt={drawer.createdAt} updatedAt={drawer.updatedAt} />
        </Drawer>
      )}

      {(creating || editing) && (
        <Modal title={editing ? "Edit Project" : "New Capital Project"} onClose={() => { setCreating(false); setEditing(null); }}>
          <div className="space-y-3">
            {!editing && <Field label="ID"><FormInput value={form.id} onChange={(e) => f("id")(e.target.value)} placeholder="cp-example" /></Field>}
            <Field label="Substation">
              <FormSelect value={form.substationId} onChange={(e) => f("substationId")(e.target.value)}>
                {substations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </FormSelect>
            </Field>
            <Field label="Project Name"><FormInput value={form.projectName} onChange={(e) => f("projectName")(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Upgrade Type">
                <FormSelect value={form.upgradeType} onChange={(e) => f("upgradeType")(e.target.value)}>
                  {UPGRADE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </FormSelect>
              </Field>
              <Field label="Status">
                <FormSelect value={form.status} onChange={(e) => f("status")(e.target.value)}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </FormSelect>
              </Field>
              <Field label="Est. Cost (USD)"><FormInput type="number" value={form.estimatedCostUSD} onChange={(e) => f("estimatedCostUSD")(Number(e.target.value))} /></Field>
              <Field label="Added Capacity MW"><FormInput type="number" value={form.addedCapacityMW} onChange={(e) => f("addedCapacityMW")(Number(e.target.value))} /></Field>
              <Field label="Implementation (months)"><FormInput type="number" value={form.implementationMonths} onChange={(e) => f("implementationMonths")(Number(e.target.value))} /></Field>
              <Field label="Risk Reduction (0–100)"><FormInput type="number" min="0" max="100" value={form.riskReduction} onChange={(e) => f("riskReduction")(Number(e.target.value))} /></Field>
            </div>
            <Field label="Priority Score (0–100)"><FormInput type="number" min="0" max="100" value={form.priorityScore} onChange={(e) => f("priorityScore")(Number(e.target.value))} /></Field>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <FormActions onCancel={() => { setCreating(false); setEditing(null); }} onSave={handleSubmit} saving={saving} />
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDelete name={deleting.projectName} onConfirm={handleDelete} onCancel={() => setDeleting(null)} loading={deleteLoading} />
      )}
    </>
  );
}

// ── Shared tab toolbar ────────────────────────────────────────────────────────

function TabToolbar({
  query, onQuery, onCreate, label,
}: {
  query: string;
  onQuery: (q: string) => void;
  onCreate: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}s…`}
          className="h-8 pl-9 text-sm border-border/40 bg-background/50"
        />
      </div>
      <Button size="sm" className="h-8 gap-1.5" onClick={onCreate}>
        <Plus className="h-3.5 w-3.5" />
        New {label}
      </Button>
    </div>
  );
}

// ── Row action buttons ────────────────────────────────────────────────────────

function RowActions({
  onEdit,
  onDelete,
  openHref,
}: {
  onEdit: () => void;
  onDelete: () => void;
  openHref?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {openHref && (
        <Link
          href={openHref}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-cyan-400"
          title="Open Asset"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
      <button
        onClick={onEdit}
        className="rounded p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        title="Edit"
      >
        <Edit2 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Form actions ──────────────────────────────────────────────────────────────

function FormActions({
  onCancel, onSave, saving,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-border/30 pt-3">
      <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export function AssetManagementPanel() {
  const [activeTab, setActiveTab] = useState<AssetTab>("substations");

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <CardTitle>Asset Management</CardTitle>
        </div>
        <CardDescription>
          Create, edit, and manage utility infrastructure assets backed by Supabase
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg border border-border/40 p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "substations"      && <SubstationsTab />}
        {activeTab === "transformers"     && <TransformersTab />}
        {activeTab === "feeders"          && <FeedersTab />}
        {activeTab === "capital-projects" && <CapitalProjectsTab />}
      </CardContent>
    </Card>
  );
}
