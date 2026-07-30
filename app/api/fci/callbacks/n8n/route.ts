import { NextResponse } from "next/server";
import {
  FciN8nContractValidationError,
  validateFciCallbackPayload
} from "@/lib/appels-offres/fci/n8n-contract.ts";
import { getFciN8nIntegrationConfig } from "@/lib/appels-offres/fci/n8n-config.ts";
import { applyFciN8nCallback } from "@/lib/appels-offres/fci/service.ts";
import {
  N8nCallbackAuthError,
  verifyN8nCallbackAuthentication
} from "@/lib/integrations/n8n-callback-auth.ts";

export const runtime = "nodejs";

function readRequiredHeader(request: Request, name: string) {
  const value = request.headers.get(name)?.trim();
  return value || null;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        {
          error: "Le callback FCI doit utiliser application/json.",
          code: "INVALID_CONTENT_TYPE"
        },
        { status: 415 }
      );
    }

    const config = getFciN8nIntegrationConfig();
    const rawBody = await request.text();

    verifyN8nCallbackAuthentication({
      authorizationHeader: request.headers.get("authorization"),
      expectedToken: config.callbackToken,
      timestampHeader: request.headers.get("x-callback-timestamp"),
      signatureHeader: request.headers.get("x-callback-signature"),
      rawBody,
      secret: config.callbackSecret,
      maxAgeMs: config.callbackMaxAgeMs
    });

    const headerContractVersion = readRequiredHeader(request, "x-contract-version");
    if (headerContractVersion !== config.contractVersion) {
      return NextResponse.json(
        {
          error: "Version de contrat FCI inattendue.",
          code: "CONTRACT_VERSION_MISMATCH"
        },
        { status: 409 }
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        {
          error: "Le callback FCI n8n ne contient pas un JSON valide.",
          code: "INVALID_JSON"
        },
        { status: 400 }
      );
    }

    const payload = validateFciCallbackPayload(parsedBody, config.contractVersion);
    const result = await applyFciN8nCallback(payload);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof N8nCallbackAuthError) {
      return NextResponse.json(
        { error: error.message, code: "UNAUTHORIZED_CALLBACK" },
        { status: 401 }
      );
    }

    if (error instanceof FciN8nContractValidationError) {
      return NextResponse.json(
        { error: error.message, code: "INVALID_CALLBACK_CONTRACT" },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Impossible de traiter le callback FCI n8n.";
    return NextResponse.json(
      { error: message, code: "FCI_CALLBACK_INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
