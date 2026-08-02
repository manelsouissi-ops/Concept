import { NextResponse } from "next/server";
import {
  parseFciValidatePayload,
  parseRequestedModule,
  toFciErrorResponse,
  validateFciModule
} from "@/lib/appels-offres/fci/service.ts";
import { resolveCurrentUserFromRequest } from "@/lib/auth/current-user.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { code, module } = await params;
    const body = await request.json();
    const data = await validateFciModule(
      code,
      parseRequestedModule(module),
      parseFciValidatePayload(body),
      await resolveCurrentUserFromRequest(request)
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
