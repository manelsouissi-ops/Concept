import test, { after } from "node:test";
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { closeUsersPool, createUser } from "../users/repository.ts";
import { hashPassword } from "./passwords.ts";
import {
  authenticateWithPassword,
  logoutAuthenticatedSession,
  resolveAuthenticatedSession
} from "./session.ts";
import { AuthError } from "./errors.ts";
import { resolveCurrentUserFromRequest } from "./request-user.ts";
import { closeAuthPool, ensureAuthenticationSchema } from "./repository.ts";
import { canAccess } from "./rbac.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

process.env.AUTH_SECRET ||= "concept-test-auth-secret";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const createdEmails = new Set<string>();

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

async function createAuthenticatedTestUser(input?: {
  role?: "ADMIN" | "COMMERCIAL" | "FINANCE" | "OPERATIONS" | "DIRECTION_GENERALE";
  departmentCode?: "ADMINISTRATION" | "COMMERCIAL" | "FINANCE" | "OPERATIONS" | "DIRECTION_GENERALE";
  status?: "ACTIVE" | "INACTIVE" | "INVITED" | "LOCKED";
  password?: string;
}) {
  await ensureAuthenticationSchema();
  const password = input?.password ?? "Test-Password-123!";
  const suffix = randomUUID().slice(0, 8);
  const email = `auth-${suffix}@concept.local`;
  createdEmails.add(email.toLowerCase());

  const user = await createUser({
    firstName: "Auth",
    lastName: suffix,
    email,
    jobTitle: "Analyste",
    departmentCode: input?.departmentCode ?? "COMMERCIAL",
    role: input?.role ?? "COMMERCIAL",
    status: input?.status ?? "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  if (!user || !cleanupPool) {
    throw new Error("User creation failed.");
  }

  await cleanupPool.query(
    `
      update public.app_users
      set
        password_hash = $2,
        password_updated_at = now(),
        failed_login_attempts = 0,
        locked_until = null
      where id = $1
    `,
    [user.id, await hashPassword(password)]
  );

  return { user, password };
}

after(async () => {
  if (cleanupPool) {
    for (const email of createdEmails) {
      await cleanupPool.query("delete from public.app_users where normalized_email = lower($1)", [email]);
    }

    await cleanupPool.end();
  }

  await Promise.all([closeAuthPool(), closeUsersPool()]);
});

test("valid login resolves the authenticated current user and logout invalidates the session", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { user, password } = await createAuthenticatedTestUser({
    role: "COMMERCIAL",
    departmentCode: "COMMERCIAL",
    status: "ACTIVE"
  });

  const authenticated = await authenticateWithPassword({
    email: user.email,
    password
  });

  assert.equal(authenticated.currentUser.email, user.email);
  assert.equal(authenticated.currentUser.role, "COMMERCIAL");

  const resolved = await resolveAuthenticatedSession(authenticated.sessionToken);
  assert.ok(resolved);
  assert.equal(resolved?.currentUser.email, user.email);

  const request = new Request("http://localhost:3000/api/profile", {
    headers: {
      cookie: `concept_session=${authenticated.sessionToken}`,
      "x-concept-dev-role": "ADMIN"
    }
  });
  const currentUser = await resolveCurrentUserFromRequest(request);
  assert.equal(currentUser.role, "COMMERCIAL");

  await logoutAuthenticatedSession({
    sessionToken: authenticated.sessionToken,
    userId: user.id,
    email: user.email
  });

  const afterLogout = await resolveAuthenticatedSession(authenticated.sessionToken);
  assert.equal(afterLogout, null);
});

test("unknown email and invalid password both fail with the same safe message", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { user, password } = await createAuthenticatedTestUser();

  await assert.rejects(
    () =>
      authenticateWithPassword({
        email: "unknown-user@concept.local",
        password
      }),
    (error: unknown) =>
      error instanceof AuthError
      && error.code === "AUTH_INVALID_CREDENTIALS"
      && error.message === "Email ou mot de passe incorrect."
  );

  await assert.rejects(
    () =>
      authenticateWithPassword({
        email: user.email,
        password: "Wrong-Password-123!"
      }),
    (error: unknown) =>
      error instanceof AuthError
      && error.code === "AUTH_INVALID_CREDENTIALS"
      && error.message === "Email ou mot de passe incorrect."
  );
});

test("inactive and locked users are denied before a session is created", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const inactive = await createAuthenticatedTestUser({ status: "INACTIVE" });
  const locked = await createAuthenticatedTestUser({ status: "LOCKED" });

  for (const candidate of [inactive, locked]) {
    await assert.rejects(
      () =>
        authenticateWithPassword({
          email: candidate.user.email,
          password: candidate.password
        }),
      (error: unknown) =>
        error instanceof AuthError
        && error.code === "AUTH_ACCOUNT_DENIED"
        && error.status === 403
    );
  }
});

test("request-based auth rejects anonymous access and keeps RBAC tied to the persisted role", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await assert.rejects(
    () =>
      resolveCurrentUserFromRequest(
        new Request("http://localhost:3000/api/administration/utilisateurs")
      ),
    (error: unknown) =>
      error instanceof AuthError
      && error.code === "AUTH_REQUIRED"
      && error.status === 401
  );

  const { user, password } = await createAuthenticatedTestUser({
    role: "COMMERCIAL",
    departmentCode: "COMMERCIAL",
    status: "ACTIVE"
  });
  const authenticated = await authenticateWithPassword({
    email: user.email,
    password
  });
  const currentUser = await resolveCurrentUserFromRequest(
    new Request("http://localhost:3000/api/administration/utilisateurs", {
      headers: {
        cookie: `concept_session=${authenticated.sessionToken}`,
        "x-concept-dev-role": "ADMIN"
      }
    })
  );
  assert.equal(currentUser.role, "COMMERCIAL");
  assert.equal(canAccess(currentUser.role, "administration"), false);
});
