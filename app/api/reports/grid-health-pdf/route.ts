import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import {
  GridHealthReport,
  type GridHealthReportProps,
} from "@/lib/pdf/grid-health-report";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(ctx.role, "data:export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body as GridHealthReportProps;

  try {
    const element = React.createElement(GridHealthReport, {
      ...data,
      tenantName: data.tenantName ?? ctx.tenantName,
    }) as React.ReactElement<DocumentProps>;

    const buffer = await renderToBuffer(element);
    const bytes = new Uint8Array(buffer);

    const date = new Date().toISOString().split("T")[0];

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="grid-health-report-${date}.pdf"`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (err) {
    console.error("[reports/grid-health-pdf] Error:", err);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
