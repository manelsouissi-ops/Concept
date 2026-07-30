import { NextResponse } from "next/server";
import {
  getSoftwareById,
  updateSoftware
} from "@/lib/administration/logiciels/repository.ts";
import { parseSoftwareFormData } from "@/lib/administration/logiciels/validation.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identifiant logiciel invalide.");
  }

  return id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const software = await getSoftwareById(parseId(id));

    if (!software) {
      return NextResponse.json({ error: "Logiciel introuvable." }, { status: 404 });
    }

    return NextResponse.json(software);
  } catch (error) {
    return NextResponse.json({ error: asErrorMessage(error) }, { status: 400 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const software = await updateSoftware(parseId(id), parseSoftwareFormData(await request.formData()));

    if (!software) {
      return NextResponse.json({ error: "Logiciel introuvable." }, { status: 404 });
    }

    return NextResponse.json({ software });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Un logiciel avec ce nom normalise existe deja." },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: asErrorMessage(error) }, { status: 400 });
  }
}
