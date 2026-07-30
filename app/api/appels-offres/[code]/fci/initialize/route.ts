import { NextResponse } from "next/server";
import {
  initializeFciWorkspace,
  toFciErrorResponse
} from "@/lib/appels-offres/fci/service.ts";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const data = await initializeFciWorkspace(code);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
