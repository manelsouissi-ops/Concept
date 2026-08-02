import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import {
  closeUsersPool,
  createUser,
  ensureUserManagementSchema,
  getCurrentDevelopmentUser,
  getDevelopmentUserState,
  getUserByEmail,
  listDepartments,
  setCurrentDevelopmentUser
} from "./repository.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const createdEmails = new Set<string>();
let originalDevelopmentUserId: number | null = null;

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

async function createUniqueUser(overrides: Partial<Parameters<typeof createUser>[0]> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const email = overrides.email ?? `user-${suffix}@concept.local`;
  createdEmails.add(email.toLowerCase());

  const user = await createUser({
    firstName: overrides.firstName ?? "Test",
    lastName: overrides.lastName ?? "User",
    email,
    jobTitle: overrides.jobTitle ?? "Analyste",
    departmentCode: overrides.departmentCode ?? "FINANCE",
    role: overrides.role ?? "FINANCE",
    status: overrides.status ?? "INVITED",
    avatarUrl: overrides.avatarUrl ?? null,
    phone: overrides.phone ?? null,
    language: overrides.language ?? "fr-FR",
    timezone: overrides.timezone ?? "Europe/Paris"
  });

  if (!user) {
    throw new Error("User creation returned null.");
  }

  return user;
}

after(async () => {
  if (cleanupPool) {
    if (originalDevelopmentUserId) {
      try {
        await setCurrentDevelopmentUser(originalDevelopmentUserId);
      } catch {
        // Ignore restoration issues during cleanup.
      }
    }

    for (const email of createdEmails) {
      await cleanupPool.query("delete from public.app_users where normalized_email = lower($1)", [email]);
    }

    await cleanupPool.end();
  }

  await closeUsersPool();
});

test("schema initialization seeds departments and the development admin", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await ensureUserManagementSchema();
  const departments = await listDepartments();
  const bob = await getUserByEmail("bob.durand@concept.local");

  assert.equal(departments.length >= 5, true);
  assert.ok(bob);
  assert.equal(bob?.role, "ADMIN");
  assert.equal(bob?.departmentCode, "ADMINISTRATION");
});

test("user creation persists role, department, status, and duplicate email protection", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const created = await createUniqueUser({
    firstName: "Sophie",
    lastName: "Budget",
    role: "FINANCE",
    departmentCode: "FINANCE",
    status: "INVITED"
  });

  assert.equal(created.role, "FINANCE");
  assert.equal(created.departmentCode, "FINANCE");
  assert.equal(created.status, "INVITED");

  await assert.rejects(
    () =>
      createUser({
        firstName: "Sophie",
        lastName: "Budget",
        email: created.email,
        jobTitle: "Finance",
        departmentCode: "FINANCE",
        role: "FINANCE",
        status: "ACTIVE",
        avatarUrl: null,
        phone: null,
        language: "fr-FR",
        timezone: "Europe/Paris"
      }),
    /existe deja/i
  );
});

test("development user switching persists the current user without headers or restart", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const initialState = await getDevelopmentUserState();
  originalDevelopmentUserId ??= initialState.currentUserId;

  const claire = await getUserByEmail("claire.martin@concept.local");
  assert.ok(claire);

  await setCurrentDevelopmentUser(claire!.id);

  const currentUser = await getCurrentDevelopmentUser();
  const updatedState = await getDevelopmentUserState();

  assert.equal(currentUser?.id, claire!.id);
  assert.equal(updatedState.currentUserId, claire!.id);
  assert.equal(updatedState.users.some((user) => user.id === claire!.id), true);
});
