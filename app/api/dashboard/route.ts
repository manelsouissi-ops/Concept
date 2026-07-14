import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/appels-offres/dashboard.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

export async function GET() {
  try {
    const payload = await getDashboardData();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: asErrorMessage(error) },
      { status: 500 }
    );
  }
}
