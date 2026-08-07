import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/errors.ts";

export function buildUsersApiSuccess<TData>(data: TData, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      data
    },
    { status }
  );
}

export function buildUsersApiError(
  code: string,
  message: string,
  status = 400,
  details: Record<string, unknown> = {}
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        details
      }
    },
    { status }
  );
}

export function mapUsersApiError(
  error: unknown,
  fallbackCode = "USERS_REQUEST_FAILED",
  fallbackMessage = "La requete utilisateur a echoue."
) {
  if (error instanceof AuthError) {
    return buildUsersApiError(error.code, error.message, error.status);
  }

  const message = error instanceof Error ? error.message : fallbackMessage;

  if (/introuvable/i.test(message)) {
    return buildUsersApiError("USER_NOT_FOUND", message, 404);
  }

  if (/existe deja/i.test(message)) {
    return buildUsersApiError("USER_EMAIL_ALREADY_EXISTS", message, 409);
  }

  if (/invalide|obligatoire/i.test(message)) {
    return buildUsersApiError("USER_VALIDATION_ERROR", message, 400);
  }

  return buildUsersApiError(fallbackCode, message || fallbackMessage, 500);
}
