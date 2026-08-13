import { NextResponse } from "next/server";
import { buildExtractionIdentityPreview } from "@/lib/appels-offres/repository.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { readFicheBundle } from "@/lib/storage";

export const runtime = "nodejs";

// Read-only preview of what the (draft, not yet validated) Fiche CDC
// extraction detected for the tender identity fields - used by the "Nouvel
// appel d'offres" wizard's review step. Never writes anything; the actual
// tender-identity fields are only persisted when the Commercial confirms
// (PUT /api/appels-offres/[code]), same as manual edits always have been.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse) {
      return deniedResponse;
    }

    const { code } = await params;
    const fiche = await readFicheBundle(code);
    return NextResponse.json(buildExtractionIdentityPreview(fiche.extraction));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Aucune information detectee pour ce dossier.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
