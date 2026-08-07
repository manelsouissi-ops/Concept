export type AuthErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_ACCOUNT_DENIED"
  | "AUTH_CONFIGURATION_ERROR";

export class AuthError extends Error {
  code: AuthErrorCode;
  status: number;

  constructor(code: AuthErrorCode, message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}
