import { createHmac, timingSafeEqual } from "node:crypto";

export class N8nCallbackAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "N8nCallbackAuthError";
  }
}

function extractBearerToken(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function normalizeSignature(signature: string) {
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildN8nCallbackSignature(
  secret: string,
  timestamp: string,
  rawBody: string
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verifyN8nCallbackAuthentication({
  authorizationHeader,
  expectedToken,
  timestampHeader,
  signatureHeader,
  rawBody,
  secret,
  maxAgeMs = 5 * 60 * 1000
}: {
  authorizationHeader: string | null;
  expectedToken: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  secret: string;
  maxAgeMs?: number;
}) {
  const token = extractBearerToken(authorizationHeader);
  if (!token || !constantTimeEquals(token, expectedToken)) {
    throw new N8nCallbackAuthError("Jeton de callback invalide.");
  }

  if (!timestampHeader?.trim()) {
    throw new N8nCallbackAuthError("Horodatage de callback manquant.");
  }

  const timestamp = timestampHeader.trim();
  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    throw new N8nCallbackAuthError("Horodatage de callback invalide.");
  }

  if (Math.abs(Date.now() - parsedTimestamp) > maxAgeMs) {
    throw new N8nCallbackAuthError("Horodatage de callback expire.");
  }

  if (!signatureHeader?.trim()) {
    throw new N8nCallbackAuthError("Signature de callback manquante.");
  }

  const expectedSignature = buildN8nCallbackSignature(secret, timestamp, rawBody);
  const providedSignature = normalizeSignature(signatureHeader.trim());

  if (!constantTimeEquals(providedSignature, expectedSignature)) {
    throw new N8nCallbackAuthError("Signature de callback invalide.");
  }
}
