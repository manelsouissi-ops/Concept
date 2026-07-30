import { NextResponse } from "next/server";
import { validateFciAiPayload } from "@/lib/appels-offres/fci/ai-validation.ts";
import {
  getFciN8nContractVersion,
  getFciWebhookToken
} from "@/lib/appels-offres/fci/n8n-config.ts";

export const runtime = "nodejs";

function extractBearerToken(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function POST(request: Request) {
  try {
    let expectedToken = "";
    try {
      expectedToken = getFciWebhookToken();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FCI_CONFIGURATION_ERROR",
            message: "FCI_N8N_WEBHOOK_TOKEN ou N8N_WEBHOOK_TOKEN est absent."
          }
        },
        { status: 500 }
      );
    }

    const providedToken = extractBearerToken(request.headers.get("authorization"));
    if (!providedToken || providedToken !== expectedToken) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Jeton de validation FCI invalide."
          }
        },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Le corps de validation FCI doit etre un objet JSON."
          }
        },
        { status: 400 }
      );
    }

    const record = body as Record<string, unknown>;
    const contractVersion =
      typeof record.contract_version === "string"
        ? record.contract_version.trim()
        : "";
    if (contractVersion !== getFciN8nContractVersion()) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "CONTRACT_VERSION_MISMATCH",
            message: "Version de contrat FCI inattendue."
          }
        },
        { status: 409 }
      );
    }

    const moduleCode =
      typeof record.module_code === "string" ? record.module_code.trim() : "";
    const validation = validateFciAiPayload(moduleCode, record.payload);

    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: true,
          valid: false,
          errors: validation.errors
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        valid: true,
        normalized: validation.data
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur de validation FCI inattendue.";
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FCI_VALIDATION_INTERNAL_ERROR",
          message
        }
      },
      { status: 500 }
    );
  }
}
