import { NextResponse } from "next/server";
import {
  getFciModule,
  parseFciSavePayload,
  parseRequestedModule,
  saveFciModuleEdits,
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
    const data = await getFciModule(code, parseRequestedModule(module), currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }

    const { code, module } = await params;
    const body = await request.json();
    const data = await saveFciModuleEdits(
      code,
      parseRequestedModule(module),
      parseFciSavePayload(body),
      currentUser
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
