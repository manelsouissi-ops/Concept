import assert from "node:assert/strict";
import type { CurrentUser } from "../auth/rbac.ts";
import {
  ensureUserManagementSchema,
  getUserByEmail
} from "../users/repository.ts";
import type { UserRecord } from "../users/types.ts";

function toCurrentUser(user: UserRecord): CurrentUser {
  return {
    id: String(user.id),
    firstName: user.firstName,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    departmentCode: user.departmentCode,
    departmentLabel: user.departmentName,
    jobTitle: user.jobTitle,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    language: user.language,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    isDevelopmentUser: true
  };
}

let cachedActorsPromise:
  | Promise<{
      admin: CurrentUser;
      commercial: CurrentUser;
      finance: CurrentUser;
      operations: CurrentUser;
      dg: CurrentUser;
    }>
  | null = null;

export async function getSeededActors() {
  if (!cachedActorsPromise) {
    cachedActorsPromise = (async () => {
      await ensureUserManagementSchema();

      const [admin, commercial, finance, operations, dg] = await Promise.all([
        getUserByEmail("bob.durand@concept.local"),
        getUserByEmail("claire.martin@concept.local"),
        getUserByEmail("sophie.bernard@concept.local"),
        getUserByEmail("marc.leroy@concept.local"),
        getUserByEmail("isabelle.moreau@concept.local")
      ]);

      assert.ok(admin, "Expected seeded admin user.");
      assert.ok(commercial, "Expected seeded commercial user.");
      assert.ok(finance, "Expected seeded finance user.");
      assert.ok(operations, "Expected seeded operations user.");
      assert.ok(dg, "Expected seeded DG user.");

      return {
        admin: toCurrentUser(admin),
        commercial: toCurrentUser(commercial),
        finance: toCurrentUser(finance),
        operations: toCurrentUser(operations),
        dg: toCurrentUser(dg)
      };
    })();
  }

  return cachedActorsPromise;
}
