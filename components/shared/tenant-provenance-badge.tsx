import { Badge } from "@/components/ui/badge";
import type { ProvenanceInfo } from "@/lib/provenance";

interface TenantProvenanceBadgeProps {
  source: "db" | "mock";
  tenantId?: string | null;
  provenance?: ProvenanceInfo | null;
  compact?: boolean;
}

export function TenantProvenanceBadge({
  source,
  tenantId,
  provenance,
  compact = false,
}: TenantProvenanceBadgeProps) {
  let label = "Data Source";
  let variant: "success" | "warning" | "danger" = "warning";
  let title = "";

  if (source === "db" && tenantId) {
    label = "Live Tenant Data";
    variant = "success";
    title = "Data loaded from tenant database";
  } else if (source === "mock" && tenantId) {
    label = "Demo Tenant Data";
    variant = "warning";
    title = "Demo data for this tenant";
  } else {
    label = "Mock Fallback";
    variant = "danger";
    title = "System fallback to mock data";
  }

  if (compact) {
    // Only show an icon or abbreviation in compact mode
    const abbr = source === "db" ? "DB" : "Mock";
    return (
      <Badge variant={variant} title={title} className="text-xs">
        {abbr}
      </Badge>
    );
  }

  let freshness = "";
  if (provenance) {
    if (provenance.freshness === "live") freshness = " (Live)";
    else if (provenance.freshness === "delayed") freshness = " (Delayed)";
  }

  return (
    <Badge variant={variant} title={title} className="text-xs">
      {label}
      {freshness}
    </Badge>
  );
}
