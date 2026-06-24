import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbAccount } from "@/lib/db/types";
import type { Account } from "@/lib/data/accounts";

// ── Row → domain mapper ───────────────────────────────────────────────────────

function toAccount(row: DbAccount): Account {
  return {
    id:                   row.id,
    name:                 row.name,
    type:                 row.type as Account["type"],
    status:               row.status as Account["status"],
    annualLoadMW:         Number(row.annual_load_mw),
    projectedGrowthMW:    Number(row.projected_growth_mw),
    territory:            row.territory ?? "",
    estimatedRevenueUSD:  Number(row.estimated_revenue_usd),
    estimatedARR:         Number(row.estimated_arr),
    dealProbability:      Number(row.deal_probability),
    expectedCloseDate:    row.expected_close_date ?? "",
    forecastQuarter:      row.forecast_quarter ?? "",
    capacityRequiredMW:   Number(row.capacity_required_mw),
    priority:             (row.priority as Account["priority"]) ?? "medium",
    riskRating:           (row.risk_rating as Account["riskRating"]) ?? "medium",
    contactName:          row.contact_name ?? "",
    contactTitle:         row.contact_title ?? "",
    activeProjects:       [],   // not stored in DB — enriched client-side if needed
    competitors:          [],
    blockers:             [],
    notes:                row.notes ?? "",
  };
}

// ── Domain → row mapper ───────────────────────────────────────────────────────

function fromAccount(
  a: Account,
  tenantId: string
): Omit<DbAccount, "created_at" | "updated_at"> {
  return {
    id:                    a.id,
    tenant_id:             tenantId,
    name:                  a.name,
    type:                  a.type,
    status:                a.status,
    annual_load_mw:        a.annualLoadMW,
    projected_growth_mw:   a.projectedGrowthMW,
    territory:             a.territory || null,
    estimated_revenue_usd: a.estimatedRevenueUSD,
    estimated_arr:         a.estimatedARR,
    deal_probability:      a.dealProbability,
    expected_close_date:   a.expectedCloseDate || null,
    forecast_quarter:      a.forecastQuarter || null,
    capacity_required_mw:  a.capacityRequiredMW,
    priority:              a.priority,
    risk_rating:           a.riskRating,
    contact_name:          a.contactName || null,
    contact_title:         a.contactTitle || null,
    notes:                 a.notes || null,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class AccountRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Returns all accounts. Pass tenantId to scope to a specific tenant.
   * Without tenantId (super admin), returns all tenants' accounts.
   */
  async findAll(tenantId?: string): Promise<Account[]> {
    let q = this.client
      .from("accounts")
      .select("*")
      .order("name");

    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { data, error } = await q;
    if (error) throw new Error(`[AccountRepository.findAll] ${error.message}`);
    return (data as DbAccount[]).map(toAccount);
  }

  async findById(id: string): Promise<Account | null> {
    const { data, error } = await this.client
      .from("accounts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`[AccountRepository.findById] ${error.message}`);
    if (!data) return null;
    return toAccount(data as DbAccount);
  }

  async findByStatus(
    status: Account["status"],
    tenantId?: string
  ): Promise<Account[]> {
    let q = this.client
      .from("accounts")
      .select("*")
      .eq("status", status)
      .order("name");

    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { data, error } = await q;
    if (error) throw new Error(`[AccountRepository.findByStatus] ${error.message}`);
    return (data as DbAccount[]).map(toAccount);
  }

  async upsert(account: Account, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("accounts")
      .upsert(fromAccount(account, tenantId), { onConflict: "id" });

    if (error) throw new Error(`[AccountRepository.upsert] ${error.message}`);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from("accounts")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`[AccountRepository.delete] ${error.message}`);
  }

  /** Returns accounts with DB audit timestamps. */
  async listManaged(tenantId?: string): Promise<(Account & { createdAt: string; updatedAt: string })[]> {
    let q = this.client
      .from("accounts")
      .select("*")
      .order("name");

    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { data, error } = await q;
    if (error) throw new Error(`[AccountRepository.listManaged] ${error.message}`);
    return (data as (DbAccount & { created_at: string; updated_at: string })[]).map((row) => ({
      ...toAccount(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async count(tenantId?: string): Promise<number> {
    let q = this.client
      .from("accounts")
      .select("*", { count: "exact", head: true });

    if (tenantId) q = q.eq("tenant_id", tenantId);

    const { count, error } = await q;
    if (error) throw new Error(`[AccountRepository.count] ${error.message}`);
    return count ?? 0;
  }
}
