import { NextResponse } from "next/server";
import {
  assignFciModule,
  toWorkflowErrorResponse
} from "@/lib/appels-offres/workflow/service.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }

    const { code, module } = await params;
    const body = (await request.json()) as { assigned_user_id?: unknown };
    const assignedUserId = Number(body.assigned_user_id);

    if (!Number.isInteger(assignedUserId) || assignedUserId < 1) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_ASSIGNED_USER",
            message: "Aucun utilisateur valide n'a ete selectionne.",
            details: {}
          }
        },
        { status: 422 }
      );
    }

    const data = await assignFciModule({
      code,
      moduleCode: module as "B" | "C",
      assignedUserId,
      currentUser
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const { status, body } = toWorkflowErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

