import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { ScenarioRepository } from "@/lib/db/repositories/scenario.repository";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ success: true } | { error: string }>> {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const repo = new ScenarioRepository(getServerClient());
    await repo.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/scenarios DELETE]", err);
    return NextResponse.json({ error: "Failed to delete scenario" }, { status: 500 });
  }
}
