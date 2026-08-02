import { NextResponse } from "next/server";
import { getFciWorkspace, toFciErrorResponse } from "@/lib/appels-offres/fci/service.ts";
import { resolveCurrentUserFromRequest } from "@/lib/auth/current-user.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const data = await getFciWorkspace(code, await resolveCurrentUserFromRequest(request));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
