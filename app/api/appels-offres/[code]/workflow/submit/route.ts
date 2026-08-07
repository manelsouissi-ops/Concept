import { NextResponse } from "next/server";
import {
  submitGoNoGoToDg,
  toWorkflowErrorResponse
} from "@/lib/appels-offres/workflow/service.ts";
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
    const data = await submitGoNoGoToDg(code, currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toWorkflowErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

