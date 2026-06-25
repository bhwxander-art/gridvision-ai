import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/db/audit";

/**
 * Customer Onboarding Workflow
 * Guides new customers through setup: profile → assets → first scenario → ROI validation
 */

export type OnboardingStep =
  | "welcome"
  | "company-profile"
  | "asset-import"
  | "first-scenario"
  | "roi-validation"
  | "team-setup"
  | "training-complete";

export interface OnboardingProgress {
  tenantId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  stepData: Record<OnboardingStep, Record<string, unknown>>;
  startedAt: string;
  completedAt?: string;
}

// ── Step Configurations ────────────────────────────────────────────────────────

export const ONBOARDING_STEPS: Record<OnboardingStep, {
  title: string;
  description: string;
  estimatedMinutes: number;
  optional: boolean;
}> = {
  welcome: {
    title: "Welcome to GridVision",
    description: "Quick orientation and feature overview",
    estimatedMinutes: 5,
    optional: false,
  },
  "company-profile": {
    title: "Set Up Company Profile",
    description: "Tell us about your utility and service territory",
    estimatedMinutes: 5,
    optional: false,
  },
  "asset-import": {
    title: "Import Your Assets",
    description: "Upload substations, transformers, and feeders via CSV",
    estimatedMinutes: 15,
    optional: false,
  },
  "first-scenario": {
    title: "Run Your First Scenario",
    description: "Model a capacity planning scenario with your real data",
    estimatedMinutes: 10,
    optional: false,
  },
  "roi-validation": {
    title: "Validate Your ROI",
    description: "Generate ROI report based on your first scenario results",
    estimatedMinutes: 5,
    optional: false,
  },
  "team-setup": {
    title: "Invite Your Team",
    description: "Add other team members and assign roles",
    estimatedMinutes: 10,
    optional: true,
  },
  "training-complete": {
    title: "Training Complete",
    description: "Ready to deploy to production",
    estimatedMinutes: 0,
    optional: false,
  },
};

// ── Step Navigation ───────────────────────────────────────────────────────────

export function getNextStep(currentStep: OnboardingStep): OnboardingStep {
  const stepOrder: OnboardingStep[] = [
    "welcome",
    "company-profile",
    "asset-import",
    "first-scenario",
    "roi-validation",
    "team-setup",
    "training-complete",
  ];

  const currentIndex = stepOrder.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex === stepOrder.length - 1) {
    return "training-complete";
  }

  return stepOrder[currentIndex + 1];
}

export function getPreviousStep(currentStep: OnboardingStep): OnboardingStep | null {
  const stepOrder: OnboardingStep[] = [
    "welcome",
    "company-profile",
    "asset-import",
    "first-scenario",
    "roi-validation",
    "team-setup",
    "training-complete",
  ];

  const currentIndex = stepOrder.indexOf(currentStep);
  if (currentIndex <= 0) return null;

  return stepOrder[currentIndex - 1];
}

export function getStepsCompleted(progress: OnboardingProgress): number {
  return progress.completedSteps.length;
}

export function getProgressPercentage(progress: OnboardingProgress): number {
  const stepOrder: OnboardingStep[] = [
    "welcome",
    "company-profile",
    "asset-import",
    "first-scenario",
    "roi-validation",
    "team-setup",
  ];

  const currentIndex = stepOrder.indexOf(progress.currentStep);
  return currentIndex >= 0 ? Math.round(((currentIndex + 1) / stepOrder.length) * 100) : 0;
}

// ── Step Data Collection ───────────────────────────────────────────────────────

export interface CompanyProfileData {
  companyName: string;
  serviceTerritory: string;
  substationsCount: number;
  annualCapex: number;
  industryType: "utility" | "developer" | "consultant";
  utilityType?: "investor-owned" | "public" | "cooperative" | "municipal";
}

export interface AssetImportData {
  substationsImported: number;
  transformersImported: number;
  feedersImported: number;
  importErrors: string[];
}

export interface FirstScenarioData {
  scenarioName: string;
  substationId: string;
  loadIncrease: number; // MW
  scenarioResult: {
    capacityUtilization: number;
    bottlenecks: string[];
    recommendedUpgrades: string[];
  };
}

export interface ROIValidationData {
  estimatedSavings: number;
  paybackMonths: number;
  roi: number;
  npv3Year: number;
  validatedByUser: boolean;
}

// ── Workflow Progress Tracking ─────────────────────────────────────────────────

export async function initializeOnboarding(
  client: SupabaseClient,
  tenantId: string
): Promise<OnboardingProgress> {
  const progress: OnboardingProgress = {
    tenantId,
    currentStep: "welcome",
    completedSteps: [],
    stepData: {
      welcome: {},
      "company-profile": {},
      "asset-import": {},
      "first-scenario": {},
      "roi-validation": {},
      "team-setup": {},
      "training-complete": {},
    },
    startedAt: new Date().toISOString(),
  };

  // Store in database or cache
  await logAuditEvent(client, {
    tenantId,
    userId: "system",
    action: "tenant_create",
    resourceType: "tenant",
    resourceId: tenantId,
    changes: { event: "onboarding_started" },
  });

  return progress;
}

export async function completeOnboardingStep(
  client: SupabaseClient,
  tenantId: string,
  step: OnboardingStep,
  stepData: Record<string, unknown>
): Promise<OnboardingProgress> {
  // Update progress in database
  await logAuditEvent(client, {
    tenantId,
    userId: "system",
    action: "settings_update",
    resourceType: "settings",
    resourceId: tenantId,
    changes: { onboarding_step_completed: step },
  });

  const allStepData: Record<OnboardingStep, Record<string, unknown>> = {
    welcome: {},
    "company-profile": {},
    "asset-import": {},
    "first-scenario": {},
    "roi-validation": {},
    "team-setup": {},
    "training-complete": {},
  };
  allStepData[step] = stepData;

  return {
    tenantId,
    currentStep: getNextStep(step),
    completedSteps: [step],
    stepData: allStepData,
    startedAt: new Date().toISOString(),
  };
}

export async function finalizeOnboarding(
  client: SupabaseClient,
  tenantId: string
): Promise<OnboardingProgress> {
  const completedAt = new Date().toISOString();

  // Log completion
  await logAuditEvent(client, {
    tenantId,
    userId: "system",
    action: "settings_update",
    resourceType: "settings",
    resourceId: tenantId,
    changes: { onboarding_completed: completedAt },
  });

  const allStepData: Record<OnboardingStep, Record<string, unknown>> = {
    welcome: {},
    "company-profile": {},
    "asset-import": {},
    "first-scenario": {},
    "roi-validation": {},
    "team-setup": {},
    "training-complete": {},
  };

  return {
    tenantId,
    currentStep: "training-complete",
    completedSteps: [
      "welcome",
      "company-profile",
      "asset-import",
      "first-scenario",
      "roi-validation",
      "team-setup",
    ],
    stepData: allStepData,
    startedAt: new Date().toISOString(),
    completedAt,
  };
}

// ── Onboarding Status ──────────────────────────────────────────────────────────

export interface OnboardingStatus {
  isComplete: boolean;
  percentComplete: number;
  currentStep: OnboardingStep;
  estimatedTimeRemaining: number; // minutes
  nextStepTitle: string;
  canSkipToProduction: boolean; // All critical steps done?
}

export function getOnboardingStatus(progress: OnboardingProgress): OnboardingStatus {
  const percentComplete = getProgressPercentage(progress);
  const nextStep = getNextStep(progress.currentStep);
  const nextStepConfig = ONBOARDING_STEPS[nextStep];

  const criticalStepsComplete = [
    "welcome",
    "company-profile",
    "asset-import",
    "first-scenario",
  ].every((step) => progress.completedSteps.includes(step as OnboardingStep));

  const estimatedTimeRemaining = Object.values(ONBOARDING_STEPS)
    .slice(progress.completedSteps.length)
    .reduce((sum, step) => sum + step.estimatedMinutes, 0);

  return {
    isComplete: progress.currentStep === "training-complete",
    percentComplete,
    currentStep: progress.currentStep,
    estimatedTimeRemaining,
    nextStepTitle: nextStepConfig.title,
    canSkipToProduction: criticalStepsComplete,
  };
}
