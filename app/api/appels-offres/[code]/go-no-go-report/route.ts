import { NextResponse } from "next/server";
import {
  getGoNoGoReportWorkspace,
  parseSaveGoNoGoReportPayload,
  saveGoNoGoReportDraft,
  toGoNoGoReportErrorResponse
} from "@/lib/appels-offres/go-no-go-report/service.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }

    const { code } = await params;
    const data = await getGoNoGoReportWorkspace(code, currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toGoNoGoReportErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

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
    const body = await request.json();
    const data = await saveGoNoGoReportDraft(code, parseSaveGoNoGoReportPayload(body), currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toGoNoGoReportErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
