import { NextResponse } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import {
  getCommercialOwnership,
  toCommercialOwnershipErrorResponse
} from "@/lib/appels-offres/ownership.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
  if (deniedResponse) {
    return deniedResponse;
  }

  try {
    const { code } = await params;
    const ownership = await getCommercialOwnership(code);
    return NextResponse.json({ ok: true, ownership });
  } catch (error) {
    const response = toCommercialOwnershipErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
