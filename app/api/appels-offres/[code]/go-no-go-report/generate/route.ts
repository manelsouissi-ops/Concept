import { NextResponse } from "next/server";
import {
  generateGoNoGoReport,
  toGoNoGoReportErrorResponse
} from "@/lib/appels-offres/go-no-go-report/service.ts";
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
    const data = await generateGoNoGoReport(code, currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toGoNoGoReportErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
