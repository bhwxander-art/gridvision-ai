import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    source: "GridVision",
    currentLoad: 16842,
    timestamp: new Date().toISOString(),
  });
}
