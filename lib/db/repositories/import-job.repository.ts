import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbImportJob,
  ImportEntityType,
  ImportJobStatus,
} from "@/lib/db/types";
import type { RowValidationError } from "@/lib/utils/csv";

export class ImportJobRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createJob(
    tenantId:   string,
    entityType: ImportEntityType,
    filename?:  string
  ): Promise<DbImportJob> {
    const { data, error } = await this.client
      .from("import_jobs")
      .insert({
        tenant_id:      tenantId,
        entity_type:    entityType,
        status:         "pending",
        rows_processed: 0,
        rows_failed:    0,
        error_details:  [],
        filename:       filename ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`[ImportJobRepository.createJob] ${error.message}`);
    return data as DbImportJob;
  }

  async completeJob(
    id:            string,
    rowsProcessed: number,
    rowsFailed:    number,
    errors:        RowValidationError[]
  ): Promise<void> {
    const status: ImportJobStatus =
      rowsFailed === 0         ? "completed" :
      rowsProcessed > 0        ? "partial"   : "failed";

    const { error } = await this.client
      .from("import_jobs")
      .update({
        status,
        rows_processed: rowsProcessed,
        rows_failed:    rowsFailed,
        error_details:  errors.slice(0, 100), // cap stored errors at 100
        completed_at:   new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(`[ImportJobRepository.completeJob] ${error.message}`);
  }

  async failJob(id: string, message: string): Promise<void> {
    const { error } = await this.client
      .from("import_jobs")
      .update({
        status:         "failed",
        error_details:  [{ row: 0, field: "file", message }],
        completed_at:   new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(`[ImportJobRepository.failJob] ${error.message}`);
  }

  async listJobs(
    tenantId:   string,
    entityType?: ImportEntityType,
    limit = 20
  ): Promise<DbImportJob[]> {
    let q = this.client
      .from("import_jobs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (entityType) q = q.eq("entity_type", entityType);

    const { data, error } = await q;
    if (error) throw new Error(`[ImportJobRepository.listJobs] ${error.message}`);
    return data as DbImportJob[];
  }
}
