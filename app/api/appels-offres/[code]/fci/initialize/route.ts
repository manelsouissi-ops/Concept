import { NextResponse } from "next/server";
import {
  initializeFciWorkspace,
  toFciErrorResponse
} from "@/lib/appels-offres/fci/service.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }

    const { code } = await params;
    const data = await initializeFciWorkspace(code, currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
