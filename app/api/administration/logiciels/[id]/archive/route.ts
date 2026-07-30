import { NextResponse } from "next/server";
import { setSoftwareStatus } from "@/lib/administration/logiciels/repository.ts";

export const runtime = "nodejs";

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant logiciel invalide.");
  }

  return id;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const software = await setSoftwareStatus(parseId(id), "archived");

    if (!software) {
      return NextResponse.json({ error: "Logiciel introuvable." }, { status: 404 });
    }

    return NextResponse.json({ software });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation impossible." },
      { status: 400 }
    );
  }
}
