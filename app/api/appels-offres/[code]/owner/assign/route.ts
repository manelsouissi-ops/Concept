import { NextResponse } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import {
  assignCommercialOwner,
  toCommercialOwnershipErrorResponse
} from "@/lib/appels-offres/ownership.ts";

export const runtime = "nodejs";

function parseBody(body: unknown) {
  if (typeof body !== "object" || body == null || Array.isArray(body)) {
    throw new Error("Le payload d'attribution est invalide.");
  }

  const input = body as Record<string, unknown>;
  const userId = Number(input.new_owner_user_id ?? input.user_id);
  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error("Le responsable commercial cible est invalide.");
  }

  return {
    newOwnerUserId: userId,
    reason: typeof input.reason === "string" ? input.reason.trim() || null : null
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
  if (deniedResponse || !currentUser) {
    return deniedResponse;
  }

  try {
    const { code } = await params;
    const payload = parseBody(await request.json());
    const tender = await assignCommercialOwner({
      code,
      newOwnerUserId: payload.newOwnerUserId,
      reason: payload.reason,
      currentUser
    });
    return NextResponse.json({ ok: true, tender });
  } catch (error) {
    const response = toCommercialOwnershipErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
