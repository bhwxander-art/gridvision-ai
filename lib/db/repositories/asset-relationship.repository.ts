import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SubstationRepository } from "@/lib/db/repositories/substation.repository";
import { TransformerRepository } from "@/lib/db/repositories/transformer.repository";
import { FeederRepository } from "@/lib/db/repositories/feeder.repository";
import { CapitalProjectRepository } from "@/lib/db/repositories/capital-project.repository";
import type { SubstationPlan, FeederCircuit } from "@/lib/types";
import type { TransformerAsset } from "@/lib/planning-engine";
import type { UpgradeProject } from "@/lib/data/capital-projects";

// ── Return type ───────────────────────────────────────────────────────────────

export interface AssetDependencies {
  substation: SubstationPlan;
  transformers: TransformerAsset[];
  feeders: FeederCircuit[];
  capitalProjects: UpgradeProject[];
}

// ── Repository ────────────────────────────────────────────────────────────────

export class AssetRelationshipRepository {
  private readonly ss: SubstationRepository;
  private readonly tx: TransformerRepository;
  private readonly fd: FeederRepository;
  private readonly cp: CapitalProjectRepository;

  constructor(client: SupabaseClient) {
    this.ss = new SubstationRepository(client);
    this.tx = new TransformerRepository(client);
    this.fd = new FeederRepository(client);
    this.cp = new CapitalProjectRepository(client);
  }

  /**
   * Returns the full dependency tree for a substation:
   * its transformers, feeders, and open capital projects.
   * Returns null if the substation doesn't exist.
   */
  async findAssetDependencies(substationId: string): Promise<AssetDependencies | null> {
    const substation = await this.ss.findById(substationId);
    if (!substation) return null;

    // transformers and feeders are already embedded in SubstationPlan via findById
    const [capitalProjects] = await Promise.all([
      this.cp.findBySubstation(substationId),
    ]);

    return {
      substation,
      transformers: substation.transformers,
      feeders:      substation.feeders,
      capitalProjects,
    };
  }

  /**
   * Given any asset id, resolves the owning substation and returns the full
   * dependency tree. Works for transformer ids, feeder ids, and substation ids.
   * Returns null if the asset cannot be found or has no parent substation.
   */
  async findConnectedAssets(assetId: string): Promise<AssetDependencies | null> {
    // Try direct substation match first
    const directSub = await this.ss.findById(assetId);
    if (directSub) return this.findAssetDependencies(assetId);

    // Try transformer
    const transformer = await this.tx.findById(assetId);
    if (transformer) return this.findAssetDependencies(transformer.substationId);

    // Try feeder
    const feeder = await this.fd.findById(assetId);
    if (feeder) return this.findAssetDependencies(feeder.substationId);

    // Try capital project
    const project = await this.cp.findById(assetId);
    if (project) return this.findAssetDependencies(project.substationId);

    return null;
  }
}
