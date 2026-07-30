import { NextResponse } from "next/server";
import {
  getFciModuleHistory,
  parseRequestedModule,
  toFciErrorResponse
} from "@/lib/appels-offres/fci/service.ts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { code, module } = await params;
    const data = await getFciModuleHistory(code, parseRequestedModule(module));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
