import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbScenario, DbScenarioInsert } from "@/lib/db/types";

export interface SavedScenario {
  id: string;
  name: string;
  inputs: DbScenario["inputs"];
  createdAt: string;
}

function toSavedScenario(row: DbScenario): SavedScenario {
  return {
    id: row.id,
    name: row.name,
    inputs: row.inputs,
    createdAt: row.created_at,
  };
}

export class ScenarioRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findAll(): Promise<SavedScenario[]> {
    const { data, error } = await this.client
      .from("scenarios")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`[ScenarioRepository.findAll] ${error.message}`);
    return (data as DbScenario[]).map(toSavedScenario);
  }

  async save(insert: DbScenarioInsert): Promise<SavedScenario> {
    const { data, error } = await this.client
      .from("scenarios")
      .insert(insert)
      .select()
      .single();

    if (error) throw new Error(`[ScenarioRepository.save] ${error.message}`);
    return toSavedScenario(data as DbScenario);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from("scenarios")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`[ScenarioRepository.delete] ${error.message}`);
  }
}
