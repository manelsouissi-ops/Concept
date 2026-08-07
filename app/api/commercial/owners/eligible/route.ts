import { NextResponse } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import {
  assertCanManageCommercialOwnership,
  listEligibleCommercialOwners,
  toCommercialOwnershipErrorResponse
} from "@/lib/appels-offres/ownership.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
  if (deniedResponse || !currentUser) {
    return deniedResponse;
  }

  try {
    assertCanManageCommercialOwnership(currentUser);
    const users = await listEligibleCommercialOwners();
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    const response = toCommercialOwnershipErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
