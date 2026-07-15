import { NextResponse } from "next/server";
import { applyCanonicalN8nCallback } from "@/lib/appels-offres/analysis.ts";
import { validateCallbackPayload, N8nContractValidationError } from "@/lib/integrations/n8n-contract.ts";
import { getN8nIntegrationConfig } from "@/lib/integrations/n8n-config.ts";
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
    const config = getN8nIntegrationConfig();
    const rawBody = await request.text();

    verifyN8nCallbackAuthentication({
      authorizationHeader: request.headers.get("authorization"),
      expectedToken: config.callbackToken,
      timestampHeader: request.headers.get("x-callback-timestamp"),
      signatureHeader: request.headers.get("x-callback-signature"),
      rawBody,
      secret: config.callbackSecret
    });

    const headerContractVersion = readRequiredHeader(request, "x-contract-version");
    if (headerContractVersion !== config.contractVersion) {
      return NextResponse.json(
        {
          error: "Version de contrat inattendue."
        },
        { status: 409 }
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Le callback n8n ne contient pas un JSON valide." },
        { status: 400 }
      );
    }

    const payload = validateCallbackPayload(parsedBody, config.contractVersion);
    const result = await applyCanonicalN8nCallback(payload);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof N8nCallbackAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof N8nContractValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message =
      error instanceof Error ? error.message : "Impossible de traiter le callback n8n.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
