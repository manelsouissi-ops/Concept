import { NextResponse } from "next/server";
import { applyDocumentProcessingCallback } from "@/lib/appels-offres/cdc-split.ts";
import { validateDocumentProcessingCallback } from "@/lib/integrations/cdc-split-contract.ts";
import { N8nContractValidationError } from "@/lib/integrations/n8n-contract.ts";
import { getN8nIntegrationConfig } from "@/lib/integrations/n8n-config.ts";
import { N8nCallbackAuthError, verifyN8nCallbackAuthentication } from "@/lib/integrations/n8n-callback-auth.ts";

export const runtime = "nodejs";

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
    if (request.headers.get("x-contract-version")?.trim() !== config.contractVersion) {
      return NextResponse.json({ error: "Version de contrat inattendue." }, { status: 409 });
    }
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "JSON invalide." }, { status: 400 }); }
    const payload = validateDocumentProcessingCallback(body, config.contractVersion);
    const result = await applyDocumentProcessingCallback(payload);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof N8nCallbackAuthError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof N8nContractValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Callback documentaire impossible." }, { status: 500 });
  }
}
