import { parseUserRole, USER_ROLES, type UserRole } from "../auth/rbac.ts";
import {
  DEPARTMENT_CODES,
  USER_STATUSES,
  type DepartmentCode,
  type ProfileUpdateInput,
  type UserMutationInput,
  type UserStatus
} from "./types.ts";
import { buildDisplayName } from "./presentation.ts";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseDepartmentCode(value: unknown): DepartmentCode {
  if (typeof value === "string" && (DEPARTMENT_CODES as readonly string[]).includes(value)) {
    return value as DepartmentCode;
  }

  throw new Error("Le departement selectionne est invalide.");
}

function parseUserStatus(value: unknown): UserStatus {
  if (typeof value === "string" && (USER_STATUSES as readonly string[]).includes(value)) {
    return value as UserStatus;
  }

  throw new Error("Le statut utilisateur est invalide.");
}

function parseRequiredRole(value: unknown): UserRole {
  const role = parseUserRole(value);
  if (!role) {
    throw new Error(`Le role utilisateur est invalide. Roles acceptes : ${USER_ROLES.join(", ")}.`);
  }

  return role;
}

function validateSharedProfileFields(input: {
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  jobTitle: unknown;
  departmentCode: unknown;
  avatarUrl: unknown;
  phone: unknown;
  language: unknown;
  timezone: unknown;
}) {
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const email = normalizeEmail(input.email);
  const jobTitle = normalizeText(input.jobTitle);
  const departmentCode = parseDepartmentCode(input.departmentCode);
  const avatarUrl = normalizeNullableText(input.avatarUrl);
  const phone = normalizeNullableText(input.phone);
  const language = normalizeText(input.language) || "fr-FR";
  const timezone = normalizeText(input.timezone) || "Europe/Paris";

  if (!firstName) {
    throw new Error("Le prenom est obligatoire.");
  }

  if (!lastName) {
    throw new Error("Le nom est obligatoire.");
  }

  if (!email) {
    throw new Error("L'adresse email est obligatoire.");
  }

  if (!isValidEmail(email)) {
    throw new Error("L'adresse email est invalide.");
  }

  return {
    firstName,
    lastName,
    displayName: buildDisplayName(firstName, lastName),
    email,
    normalizedEmail: email,
    jobTitle,
    departmentCode,
    avatarUrl,
    phone,
    language,
    timezone
  };
}

export function validateUserMutationInput(input: UserMutationInput) {
  const shared = validateSharedProfileFields(input);
  const role = parseRequiredRole(input.role);
  const status = parseUserStatus(input.status);

  return {
    ...shared,
    role,
    status
  };
}

export function validateProfileUpdateInput(input: ProfileUpdateInput) {
  return validateSharedProfileFields(input);
}

export function parseUserPayload(body: unknown): UserMutationInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Le payload utilisateur est invalide.");
  }

  const payload = body as Record<string, unknown>;
  return {
    firstName: normalizeText(payload.firstName),
    lastName: normalizeText(payload.lastName),
    email: normalizeText(payload.email),
    jobTitle: normalizeText(payload.jobTitle),
    departmentCode: String(payload.departmentCode ?? "") as UserMutationInput["departmentCode"],
    role: String(payload.role ?? "") as UserMutationInput["role"],
    status: String(payload.status ?? "") as UserMutationInput["status"],
    avatarUrl: normalizeNullableText(payload.avatarUrl),
    phone: normalizeNullableText(payload.phone),
    language: normalizeText(payload.language),
    timezone: normalizeText(payload.timezone)
  };
}

export function parseProfilePayload(body: unknown): ProfileUpdateInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Le payload profil est invalide.");
  }

  const payload = body as Record<string, unknown>;
  return {
    firstName: normalizeText(payload.firstName),
    lastName: normalizeText(payload.lastName),
    email: normalizeText(payload.email),
    jobTitle: normalizeText(payload.jobTitle),
    departmentCode: String(payload.departmentCode ?? "") as ProfileUpdateInput["departmentCode"],
    avatarUrl: normalizeNullableText(payload.avatarUrl),
    phone: normalizeNullableText(payload.phone),
    language: normalizeText(payload.language),
    timezone: normalizeText(payload.timezone)
  };
}
