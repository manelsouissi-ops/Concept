import { NextResponse } from "next/server";
import {
  getAppelOffresDetailByCode,
  listAuditLogsForCode
} from "@/lib/appels-offres/repository.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const current = await getAppelOffresDetailByCode(code, { includeArchived: true });

    if (!current) {
      return NextResponse.json(
        { error: "Appel d'offres introuvable." },
        { status: 404 }
      );
    }

    const history = await listAuditLogsForCode(code);
    return NextResponse.json(history);
  } catch (error) {
    return NextResponse.json(
      { error: asErrorMessage(error) },
      { status: 500 }
    );
  }
}
