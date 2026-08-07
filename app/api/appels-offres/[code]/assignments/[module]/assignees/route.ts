import { NextResponse } from "next/server";
import {
  listAssignableUsersForModule,
  toWorkflowErrorResponse
} from "@/lib/appels-offres/workflow/service.ts";
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

    const { module } = await params;
    const data = await listAssignableUsersForModule(module as "B" | "C", currentUser);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toWorkflowErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

