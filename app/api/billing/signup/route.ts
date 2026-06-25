import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { onboardNewCustomer } from "@/lib/services/onboarding.service";
import { handleDatabaseError, handleValidationError } from "@/lib/utils/safe-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SignupSchema = z.object({
  companyName: z.string().min(2).max(100),
  contactEmail: z.string().email(),
  plan: z.enum(["starter", "professional", "enterprise"]),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
});

export interface SignupResponse {
  success: boolean;
  tenantId: string;
  subscriptionId: string;
  trialDaysRemaining: number;
  setupUrl?: string;
  message: string;
}

/**
 * POST /api/billing/signup
 * Create new customer tenant with subscription
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<SignupResponse | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      ),
      { status: 422 }
    );
  }

  try {
    const client = getServerClient();

    // Onboard new customer
    const result = await onboardNewCustomer(client, {
      companyName: parsed.data.companyName,
      contactEmail: parsed.data.contactEmail,
      plan: parsed.data.plan,
      billingCycle: parsed.data.billingCycle,
    });

    return NextResponse.json(
      {
        success: true,
        tenantId: result.tenantId,
        subscriptionId: result.subscriptionId,
        trialDaysRemaining: result.trialDaysRemaining,
        setupUrl: `/setup/${result.tenantId}`,
        message: result.message,
      },
      { status: 201 }
    );
  } catch (err) {
    const safe = handleDatabaseError(err, "POST /api/billing/signup");
    return NextResponse.json(safe, { status: 500 });
  }
}
