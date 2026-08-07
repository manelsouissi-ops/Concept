import { NextResponse } from "next/server";
import {
  getFciModuleHistory,
  parseRequestedModule,
  toFciErrorResponse
} from "@/lib/appels-offres/fci/service.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }

    const { code, module } = await params;
    const data = await getFciModuleHistory(code, parseRequestedModule(module), currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
