import { createHmac, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { UserRole } from "./rbac.ts";
import type { DepartmentCode, UserStatus } from "../users/types.ts";
import { ensureUserManagementSchema } from "../users/repository.ts";
import {
  getAuthSecret,
  getAuthSessionTtlSeconds,
  getDevelopmentAdminPassword,
  getDevelopmentUserPassword
} from "./config.ts";
import { hashPassword } from "./passwords.ts";

const USERS_TABLE = "public.app_users";
const DEPARTMENTS_TABLE = "public.app_departments";
const SESSIONS_TABLE = "public.app_user_sessions";
const AUTH_AUDIT_TABLE = "public.app_auth_audit_events";

type GlobalWithAuthPool = typeof globalThis & {
  __authPool?: Pool;
  __authSetupPromise?: Promise<void>;
};

type AuthUserRow = {
  id: number | string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  normalized_email: string;
  job_title: string;
  department_code: DepartmentCode;
  role: UserRole;
  status: UserStatus;
  avatar_url: string | null;
  phone: string | null;
  language: string;
  timezone: string;
  created_at: string | Date;
  updated_at: string | Date;
  last_login_at: string | Date | null;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: string | Date | null;
  password_updated_at: string | Date | null;
  department_name: string;
};

type SessionRow = {
  id: number | string;
  user_id: number | string;
  session_token_hash: string;
  created_at: string | Date;
  updated_at: string | Date;
  expires_at: string | Date;
  last_seen_at: string | Date;
  invalidated_at: string | Date | null;
  ip_address: string | null;
  user_agent: string | null;
};

export type AuthenticatedUserRecord = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  normalizedEmail: string;
  jobTitle: string;
  departmentCode: DepartmentCode;
  departmentName: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string | null;
  phone: string | null;
  language: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  passwordHash: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  passwordUpdatedAt: string | null;
};

export type AuthenticatedSessionRecord = {
  id: number;
  userId: number;
  sessionTokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  invalidatedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

type SessionResolution = {
  user: AuthenticatedUserRecord;
  session: AuthenticatedSessionRecord;
};

type SessionJoinRow = {
  session_id: number | string;
  session_user_id: number | string;
  session_token_hash: string;
  session_created_at: string | Date;
  session_updated_at: string | Date;
  session_expires_at: string | Date;
  session_last_seen_at: string | Date;
  session_invalidated_at: string | Date | null;
  session_ip_address: string | null;
  session_user_agent: string | null;
} & AuthUserRow;

type AuthAuditInput = {
  userId?: number | null;
  email?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
};

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

function getAuthPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithAuthPool = globalThis as GlobalWithAuthPool;
  if (!globalWithAuthPool.__authPool) {
    globalWithAuthPool.__authPool = new Pool({ connectionString: databaseUrl });
  }

  return globalWithAuthPool.__authPool;
}

function normalizeTimestamp(value: string | Date | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapAuthenticatedUserRow(row: AuthUserRow): AuthenticatedUserRecord {
  return {
    id: Number(row.id),
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    email: row.email,
    normalizedEmail: row.normalized_email,
    jobTitle: row.job_title,
    departmentCode: row.department_code,
    departmentName: row.department_name,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatar_url,
    phone: row.phone,
    language: row.language,
    timezone: row.timezone,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
    lastLoginAt: normalizeTimestamp(row.last_login_at),
    passwordHash: row.password_hash,
    failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
    lockedUntil: normalizeTimestamp(row.locked_until),
    passwordUpdatedAt: normalizeTimestamp(row.password_updated_at)
  };
}

function mapSessionRow(row: SessionRow): AuthenticatedSessionRecord {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    sessionTokenHash: row.session_token_hash,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString(),
    expiresAt: normalizeTimestamp(row.expires_at) ?? new Date().toISOString(),
    lastSeenAt: normalizeTimestamp(row.last_seen_at) ?? new Date().toISOString(),
    invalidatedAt: normalizeTimestamp(row.invalidated_at),
    ipAddress: row.ip_address,
    userAgent: row.user_agent
  };
}

function mapSessionJoinRow(row: SessionJoinRow): AuthenticatedSessionRecord {
  return {
    id: Number(row.session_id),
    userId: Number(row.session_user_id),
    sessionTokenHash: row.session_token_hash,
    createdAt: normalizeTimestamp(row.session_created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.session_updated_at) ?? new Date().toISOString(),
    expiresAt: normalizeTimestamp(row.session_expires_at) ?? new Date().toISOString(),
    lastSeenAt: normalizeTimestamp(row.session_last_seen_at) ?? new Date().toISOString(),
    invalidatedAt: normalizeTimestamp(row.session_invalidated_at),
    ipAddress: row.session_ip_address,
    userAgent: row.session_user_agent
  };
}

async function appendAuthAuditEvent(client: Pool | PoolClient, input: AuthAuditInput) {
  await client.query(
    `
      insert into ${AUTH_AUDIT_TABLE} (
        user_id,
        email,
        event_type,
        metadata_json,
        created_at
      )
      values ($1, $2, $3, $4::jsonb, now())
    `,
    [
      input.userId ?? null,
      input.email ?? null,
      input.eventType,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function seedDevelopmentPasswords(client: Pool | PoolClient) {
  const adminPassword = getDevelopmentAdminPassword();
  const userPassword = getDevelopmentUserPassword();
  const seededUsers = [
    ["bob.durand@concept.local", adminPassword],
    ["claire.martin@concept.local", userPassword],
    ["sophie.bernard@concept.local", userPassword],
    ["marc.leroy@concept.local", userPassword],
    ["isabelle.moreau@concept.local", userPassword]
  ] as const;

  for (const [email, password] of seededUsers) {
    if (!password) {
      continue;
    }

    const nextHash = await hashPassword(password);
    await client.query(
      `
        update ${USERS_TABLE}
        set
          password_hash = $2,
          password_updated_at = coalesce(password_updated_at, now()),
          updated_at = now()
        where normalized_email = lower($1)
          and password_hash is null
      `,
      [email, nextHash]
    );
  }
}

async function ensureAuthenticationSchemaInternal(pool: Pool) {
  await ensureUserManagementSchema();
  const client = await pool.connect();

  try {
    await client.query(`
      alter table ${USERS_TABLE}
      add column if not exists password_hash text null,
      add column if not exists password_updated_at timestamptz null,
      add column if not exists failed_login_attempts integer not null default 0,
      add column if not exists locked_until timestamptz null
    `);
    await client.query(`
      create table if not exists ${SESSIONS_TABLE} (
        id bigserial primary key,
        user_id bigint not null references ${USERS_TABLE}(id) on delete cascade,
        session_token_hash text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        expires_at timestamptz not null,
        last_seen_at timestamptz not null default now(),
        invalidated_at timestamptz null,
        ip_address text null,
        user_agent text null
      )
    `);
    await client.query(`
      create unique index if not exists app_user_sessions_token_hash_uidx
      on ${SESSIONS_TABLE} (session_token_hash)
    `);
    await client.query(`
      create index if not exists app_user_sessions_user_id_idx
      on ${SESSIONS_TABLE} (user_id, expires_at desc)
    `);
    await client.query(`
      create table if not exists ${AUTH_AUDIT_TABLE} (
        id bigserial primary key,
        user_id bigint null references ${USERS_TABLE}(id) on delete set null,
        email text null,
        event_type text not null,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create index if not exists app_auth_audit_events_user_id_idx
      on ${AUTH_AUDIT_TABLE} (user_id, created_at desc)
    `);
    await client.query(`
      create index if not exists app_auth_audit_events_email_idx
      on ${AUTH_AUDIT_TABLE} (email, created_at desc)
    `);
    await seedDevelopmentPasswords(client);
  } finally {
    client.release();
  }
}

export async function ensureAuthenticationSchema() {
  const pool = getAuthPool();
  const globalWithAuthPool = globalThis as GlobalWithAuthPool;
  if (!globalWithAuthPool.__authSetupPromise) {
    globalWithAuthPool.__authSetupPromise = ensureAuthenticationSchemaInternal(pool).catch(
      (error) => {
        globalWithAuthPool.__authSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalWithAuthPool.__authSetupPromise;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashSessionToken(rawToken: string) {
  return createHmac("sha256", getAuthSecret()).update(rawToken).digest("hex");
}

function buildUserSelect() {
  return `
    select
      u.id,
      u.first_name,
      u.last_name,
      u.display_name,
      u.email,
      u.normalized_email,
      u.job_title,
      u.department_code,
      u.role,
      u.status,
      u.avatar_url,
      u.phone,
      u.language,
      u.timezone,
      u.created_at,
      u.updated_at,
      u.last_login_at,
      u.password_hash,
      u.failed_login_attempts,
      u.locked_until,
      u.password_updated_at,
      d.name as department_name
    from ${USERS_TABLE} u
    inner join ${DEPARTMENTS_TABLE} d on d.code = u.department_code
  `;
}

export async function findAuthenticationUserByEmail(email: string) {
  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  const result = await pool.query<AuthUserRow>(
    `
      ${buildUserSelect()}
      where u.normalized_email = $1
      limit 1
    `,
    [normalizeEmail(email)]
  );

  return result.rows[0] ? mapAuthenticatedUserRow(result.rows[0]) : null;
}

export async function createUserSession(input: {
  userId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionTokenHash = hashSessionToken(sessionToken);
  const expiresAt = new Date(Date.now() + getAuthSessionTtlSeconds() * 1000).toISOString();

  const result = await pool.query<SessionRow>(
    `
      insert into ${SESSIONS_TABLE} (
        user_id,
        session_token_hash,
        expires_at,
        ip_address,
        user_agent
      )
      values ($1, $2, $3, $4, $5)
      returning
        id,
        user_id,
        session_token_hash,
        created_at,
        updated_at,
        expires_at,
        last_seen_at,
        invalidated_at,
        ip_address,
        user_agent
    `,
    [
      input.userId,
      sessionTokenHash,
      expiresAt,
      input.ipAddress ?? null,
      input.userAgent ?? null
    ]
  );

  return {
    sessionToken,
    session: mapSessionRow(result.rows[0]!)
  };
}

export async function invalidateUserSession(sessionToken: string | null | undefined) {
  if (!sessionToken) {
    return;
  }

  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  const tokenHash = hashSessionToken(sessionToken);
  await pool.query(
    `
      update ${SESSIONS_TABLE}
      set
        invalidated_at = coalesce(invalidated_at, now()),
        updated_at = now()
      where session_token_hash = $1
        and invalidated_at is null
    `,
    [tokenHash]
  );
}

export async function resolveSession(sessionToken: string | null | undefined): Promise<SessionResolution | null> {
  if (!sessionToken) {
    return null;
  }

  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  const tokenHash = hashSessionToken(sessionToken);
  const result = await pool.query<SessionJoinRow>(
    `
      select
        s.id as session_id,
        s.user_id as session_user_id,
        s.session_token_hash,
        s.created_at as session_created_at,
        s.updated_at as session_updated_at,
        s.expires_at as session_expires_at,
        s.last_seen_at as session_last_seen_at,
        s.invalidated_at as session_invalidated_at,
        s.ip_address as session_ip_address,
        s.user_agent as session_user_agent,
        u.id,
        u.first_name,
        u.last_name,
        u.display_name,
        u.email,
        u.normalized_email,
        u.job_title,
        u.department_code,
        u.role,
        u.status,
        u.avatar_url,
        u.phone,
        u.language,
        u.timezone,
        u.created_at,
        u.updated_at,
        u.last_login_at,
        u.password_hash,
        u.failed_login_attempts,
        u.locked_until,
        u.password_updated_at,
        d.name as department_name
      from ${SESSIONS_TABLE} s
      inner join ${USERS_TABLE} u on u.id = s.user_id
      inner join ${DEPARTMENTS_TABLE} d on d.code = u.department_code
      where s.session_token_hash = $1
        and s.invalidated_at is null
        and s.expires_at > now()
      limit 1
    `,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const user = mapAuthenticatedUserRow(row);
  const session = mapSessionJoinRow(row);

  const lockedUntilTimestamp = user.lockedUntil ? Date.parse(user.lockedUntil) : null;
  if (
    user.status !== "ACTIVE"
    || (lockedUntilTimestamp != null && Number.isFinite(lockedUntilTimestamp) && lockedUntilTimestamp > Date.now())
  ) {
    await invalidateUserSession(sessionToken);
    return null;
  }

  await pool.query(
    `
      update ${SESSIONS_TABLE}
      set
        updated_at = now(),
        last_seen_at = now()
      where id = $1
    `,
    [session.id]
  );

  return { user, session };
}

export async function recordSuccessfulLogin(userId: number, email: string) {
  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  await pool.query(
    `
      update ${USERS_TABLE}
      set
        last_login_at = now(),
        failed_login_attempts = 0,
        updated_at = now()
      where id = $1
    `,
    [userId]
  );
  await appendAuthAuditEvent(pool, {
    userId,
    email,
    eventType: "auth.login.success"
  });
}

export async function recordFailedLogin(input: {
  email: string;
  userId?: number | null;
  reason: "invalid_credentials" | "account_denied";
}) {
  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  if (input.userId) {
    await pool.query(
      `
        update ${USERS_TABLE}
        set
          failed_login_attempts = failed_login_attempts + 1,
          updated_at = now()
        where id = $1
      `,
      [input.userId]
    );
  }

  await appendAuthAuditEvent(pool, {
    userId: input.userId ?? null,
    email: input.email,
    eventType: `auth.login.${input.reason}`
  });
}

export async function recordLogout(userId: number | null, email: string | null) {
  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  await appendAuthAuditEvent(pool, {
    userId,
    email,
    eventType: "auth.logout"
  });
}

export async function createDevelopmentSwitcherSession(input: {
  actingAdminId: number;
  actingAdminEmail: string;
  targetUserId: number;
  targetUserEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const created = await createUserSession({
    userId: input.targetUserId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });
  await ensureAuthenticationSchema();
  const pool = getAuthPool();
  await appendAuthAuditEvent(pool, {
    userId: input.targetUserId,
    email: input.targetUserEmail,
    eventType: "auth.development_switch",
    metadata: {
      acting_admin_id: input.actingAdminId,
      acting_admin_email: input.actingAdminEmail
    }
  });

  return created;
}

export async function closeAuthPool() {
  const globalWithAuthPool = globalThis as GlobalWithAuthPool;
  if (globalWithAuthPool.__authPool) {
    await globalWithAuthPool.__authPool.end();
    globalWithAuthPool.__authPool = undefined;
    globalWithAuthPool.__authSetupPromise = undefined;
  }
}
