import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbCustomer,
  DbContact,
  DbMeeting,
  DbOpportunity,
  DbFollowUp,
  CustomerStatus,
} from "@/lib/db/types-crm";

// ── Customer Management ────────────────────────────────────────────────────────

export async function createCustomer(
  client: SupabaseClient,
  customer: Omit<DbCustomer, "id" | "created_at" | "updated_at">
): Promise<DbCustomer> {
  const { data, error } = await client
    .from("crm_customers")
    .insert(customer)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create customer: ${error.message}`);
  }

  return data as DbCustomer;
}

export async function getCustomer(
  client: SupabaseClient,
  customerId: string
): Promise<DbCustomer | null> {
  const { data, error } = await client
    .from("crm_customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch customer: ${error.message}`);
  }

  return data as DbCustomer | null;
}

export async function listCustomers(
  client: SupabaseClient,
  status?: CustomerStatus
): Promise<DbCustomer[]> {
  let query = client.from("crm_customers").select("*");

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch customers: ${error.message}`);
  }

  return (data as DbCustomer[]) || [];
}

export async function updateCustomerStatus(
  client: SupabaseClient,
  customerId: string,
  status: CustomerStatus
): Promise<DbCustomer> {
  const { data, error } = await client
    .from("crm_customers")
    .update({ status })
    .eq("id", customerId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update customer: ${error.message}`);
  }

  return data as DbCustomer;
}

// ── Contact Management ────────────────────────────────────────────────────────

export async function createContact(
  client: SupabaseClient,
  contact: Omit<DbContact, "id" | "created_at" | "updated_at">
): Promise<DbContact> {
  const { data, error } = await client
    .from("crm_contacts")
    .insert(contact)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create contact: ${error.message}`);
  }

  return data as DbContact;
}

export async function getContactsForCustomer(
  client: SupabaseClient,
  customerId: string
): Promise<DbContact[]> {
  const { data, error } = await client
    .from("crm_contacts")
    .select("*")
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch contacts: ${error.message}`);
  }

  return (data as DbContact[]) || [];
}

// ── Meeting Management ────────────────────────────────────────────────────────

export async function createMeeting(
  client: SupabaseClient,
  meeting: Omit<DbMeeting, "id" | "created_at" | "updated_at">
): Promise<DbMeeting> {
  const { data, error } = await client
    .from("crm_meetings")
    .insert(meeting)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create meeting: ${error.message}`);
  }

  return data as DbMeeting;
}

export async function getMeetingsForCustomer(
  client: SupabaseClient,
  customerId: string
): Promise<DbMeeting[]> {
  const { data, error } = await client
    .from("crm_meetings")
    .select("*")
    .eq("customer_id", customerId)
    .order("scheduled_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch meetings: ${error.message}`);
  }

  return (data as DbMeeting[]) || [];
}

// ── Opportunity Management ────────────────────────────────────────────────────

export async function createOpportunity(
  client: SupabaseClient,
  opportunity: Omit<DbOpportunity, "id" | "created_at" | "updated_at">
): Promise<DbOpportunity> {
  const { data, error } = await client
    .from("crm_opportunities")
    .insert(opportunity)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create opportunity: ${error.message}`);
  }

  return data as DbOpportunity;
}

export async function getOpportunitiesForCustomer(
  client: SupabaseClient,
  customerId: string
): Promise<DbOpportunity[]> {
  const { data, error } = await client
    .from("crm_opportunities")
    .select("*")
    .eq("customer_id", customerId)
    .order("expected_close_date");

  if (error) {
    throw new Error(`Failed to fetch opportunities: ${error.message}`);
  }

  return (data as DbOpportunity[]) || [];
}

// ── Follow-up Management ──────────────────────────────────────────────────────

export async function createFollowUp(
  client: SupabaseClient,
  followUp: Omit<DbFollowUp, "id" | "created_at" | "updated_at">
): Promise<DbFollowUp> {
  const { data, error } = await client
    .from("crm_follow_ups")
    .insert(followUp)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create follow-up: ${error.message}`);
  }

  return data as DbFollowUp;
}

export async function getFollowUpsForCustomer(
  client: SupabaseClient,
  customerId: string
): Promise<DbFollowUp[]> {
  const { data, error } = await client
    .from("crm_follow_ups")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "pending")
    .order("due_date");

  if (error) {
    throw new Error(`Failed to fetch follow-ups: ${error.message}`);
  }

  return (data as DbFollowUp[]) || [];
}

// ── CRM Dashboard Metrics ──────────────────────────────────────────────────────

export interface CRMMetrics {
  totalCustomers: number;
  byStatus: Record<CustomerStatus, number>;
  pipelineValue: number;
  avgDealSize: number;
  conversionRate: number;
  activeFollowUps: number;
  overdueTasks: number;
}

export async function getCRMMetrics(
  client: SupabaseClient
): Promise<CRMMetrics> {
  // Get all customers
  const { data: customers, error: customersError } = await client
    .from("crm_customers")
    .select("status, deal_value_usd");

  if (customersError) {
    throw new Error(`Failed to fetch CRM metrics: ${customersError.message}`);
  }

  const customerList = (customers as DbCustomer[]) || [];
  const totalCustomers = customerList.length;

  // Group by status
  const byStatus: Record<CustomerStatus, number> = {
    prospect: 0,
    evaluating: 0,
    pilot: 0,
    customer: 0,
    churned: 0,
  };

  for (const customer of customerList) {
    byStatus[customer.status]++;
  }

  // Pipeline value and avg deal size
  const winCustomers = customerList.filter((c) => c.status === "customer");
  const pipelineValue = winCustomers.reduce(
    (sum, c) => sum + (c.deal_value_usd || 0),
    0
  );
  const avgDealSize =
    winCustomers.length > 0 ? pipelineValue / winCustomers.length : 0;

  // Conversion rate (evaluating + pilot → customer)
  const evaluatingPilot = byStatus.evaluating + byStatus.pilot;
  const conversionRate =
    evaluatingPilot > 0
      ? (byStatus.customer / (evaluatingPilot + byStatus.customer)) * 100
      : 0;

  // Follow-ups
  const { data: followUps, error: followUpError } = await client
    .from("crm_follow_ups")
    .select("*")
    .eq("status", "pending");

  if (followUpError) {
    throw new Error(`Failed to fetch follow-ups: ${followUpError.message}`);
  }

  const followUpList = (followUps as DbFollowUp[]) || [];
  const now = new Date();
  const activeFollowUps = followUpList.length;
  const overdueTasks = followUpList.filter(
    (f) => new Date(f.due_date) < now
  ).length;

  return {
    totalCustomers,
    byStatus,
    pipelineValue,
    avgDealSize,
    conversionRate,
    activeFollowUps,
    overdueTasks,
  };
}
