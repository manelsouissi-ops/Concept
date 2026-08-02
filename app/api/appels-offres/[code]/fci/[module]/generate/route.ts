import { NextResponse } from "next/server";
import {
  parseRequestedModule,
  prepareFciGeneration,
  toFciErrorResponse
} from "@/lib/appels-offres/fci/service.ts";
import { resolveCurrentUserFromRequest } from "@/lib/auth/current-user.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { code, module } = await params;
    const data = await prepareFciGeneration(
      code,
      parseRequestedModule(module),
      await resolveCurrentUserFromRequest(request)
    );
    return NextResponse.json({ ok: true, data }, { status: 202 });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
