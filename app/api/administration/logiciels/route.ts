import { NextResponse } from "next/server";
import {
  createSoftware,
  listSoftware
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const items = await listSoftware({
      search: searchParams.get("search") ?? undefined,
      status:
        (searchParams.get("status") as "all" | "active" | "archived" | null) ?? undefined
    });
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: asErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const software = await createSoftware(parseSoftwareFormData(formData));
    return NextResponse.json({ software }, { status: 201 });
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
