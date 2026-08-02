import { Pool, type PoolClient } from "pg";
import type { UserRole } from "../auth/rbac.ts";
import { getDepartmentLabel } from "./presentation.ts";
import {
  validateProfileUpdateInput,
  validateUserMutationInput
} from "./validation.ts";
import type {
  DepartmentCode,
  DepartmentRecord,
  DevelopmentUserOption,
  DevelopmentUserState,
  ProfileUpdateInput,
  UserListFilters,
  UserMutationInput,
  UserRecord,
  UserStatus
} from "./types.ts";

const DEPARTMENTS_TABLE = "public.app_departments";
const USERS_TABLE = "public.app_users";
const RUNTIME_SETTINGS_TABLE = "public.app_runtime_settings";
const CURRENT_DEV_USER_SETTING_KEY = "development.current_user_id";

const SEEDED_USERS: Array<
  Omit<UserMutationInput, "avatarUrl"> & { avatarUrl?: string | null }
> = [
  {
    firstName: "Bob",
    lastName: "Durand",
    email: "bob.durand@concept.local",
    jobTitle: "Administrateur de plateforme",
    departmentCode: "ADMINISTRATION",
    role: "ADMIN",
    status: "ACTIVE",
    phone: "+33 6 10 20 30 40",
    language: "fr-FR",
    timezone: "Europe/Paris"
  },
  {
    firstName: "Claire",
    lastName: "Martin",
    email: "claire.martin@concept.local",
    jobTitle: "Responsable commerciale",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    phone: "+33 6 11 22 33 44",
    language: "fr-FR",
    timezone: "Europe/Paris"
  },
  {
    firstName: "Sophie",
    lastName: "Bernard",
    email: "sophie.bernard@concept.local",
    jobTitle: "Responsable financiere",
    departmentCode: "FINANCE",
    role: "FINANCE",
    status: "ACTIVE",
    phone: "+33 6 12 23 34 45",
    language: "fr-FR",
    timezone: "Europe/Paris"
  },
  {
    firstName: "Marc",
    lastName: "Leroy",
    email: "marc.leroy@concept.local",
    jobTitle: "Responsable operationnel",
    departmentCode: "OPERATIONS",
    role: "OPERATIONS",
    status: "ACTIVE",
    phone: "+33 6 13 24 35 46",
    language: "fr-FR",
    timezone: "Europe/Paris"
  },
  {
    firstName: "Isabelle",
    lastName: "Moreau",
    email: "isabelle.moreau@concept.local",
    jobTitle: "Direction generale",
    departmentCode: "DIRECTION_GENERALE",
    role: "DIRECTION_GENERALE",
    status: "ACTIVE",
    phone: "+33 6 14 25 36 47",
    language: "fr-FR",
    timezone: "Europe/Paris"
  }
];

type GlobalWithPool = typeof globalThis & {
  __usersPool?: Pool;
  __usersSetupPromise?: Promise<void>;
};

type DepartmentRow = {
  code: DepartmentCode;
  name: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type UserRow = {
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
  department_name: string;
};

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__usersPool) {
    globalWithPool.__usersPool = new Pool({ connectionString: databaseUrl });
  }

  return globalWithPool.__usersPool;
}

function normalizeTimestamp(value: string | Date | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapDepartmentRow(row: DepartmentRow): DepartmentRecord {
  return {
    code: row.code,
    name: row.name,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString()
  };
}

function mapUserRow(row: UserRow): UserRecord {
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
    lastLoginAt: normalizeTimestamp(row.last_login_at)
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${DEPARTMENTS_TABLE} (
        code text primary key,
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${USERS_TABLE} (
        id bigserial primary key,
        first_name text not null,
        last_name text not null,
        display_name text not null,
        email text not null,
        normalized_email text not null,
        job_title text not null default '',
        department_code text not null references ${DEPARTMENTS_TABLE}(code),
        role text not null check (role in ('ADMIN', 'COMMERCIAL', 'FINANCE', 'OPERATIONS', 'DIRECTION_GENERALE')),
        status text not null check (status in ('ACTIVE', 'INACTIVE', 'INVITED', 'LOCKED')),
        avatar_url text null,
        phone text null,
        language text not null default 'fr-FR',
        timezone text not null default 'Europe/Paris',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_login_at timestamptz null
      )
    `);
    await client.query(`
      alter table ${USERS_TABLE}
      add column if not exists display_name text,
      add column if not exists normalized_email text,
      add column if not exists job_title text not null default '',
      add column if not exists department_code text,
      add column if not exists role text not null default 'COMMERCIAL',
      add column if not exists status text not null default 'INVITED',
      add column if not exists avatar_url text null,
      add column if not exists phone text null,
      add column if not exists language text not null default 'fr-FR',
      add column if not exists timezone text not null default 'Europe/Paris',
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists last_login_at timestamptz null
    `);
    await client.query(`
      update ${USERS_TABLE}
      set
        display_name = trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')),
        normalized_email = lower(trim(email))
      where display_name is null
         or display_name = ''
         or normalized_email is null
         or normalized_email = ''
    `);
    await client.query(`
      alter table ${USERS_TABLE}
      alter column display_name set not null,
      alter column normalized_email set not null
    `);
    await client.query(`
      create unique index if not exists app_users_normalized_email_uidx
      on ${USERS_TABLE} (normalized_email)
    `);
    await client.query(`
      create index if not exists app_users_status_idx
      on ${USERS_TABLE} (status)
    `);
    await client.query(`
      create index if not exists app_users_role_idx
      on ${USERS_TABLE} (role)
    `);
    await client.query(`
      create index if not exists app_users_department_idx
      on ${USERS_TABLE} (department_code)
    `);
    await client.query(`
      create table if not exists ${RUNTIME_SETTINGS_TABLE} (
        setting_key text primary key,
        setting_value jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);

    const departments = [
      "COMMERCIAL",
      "FINANCE",
      "OPERATIONS",
      "DIRECTION_GENERALE",
      "ADMINISTRATION"
    ] as const;

    for (const code of departments) {
      await client.query(
        `
          insert into ${DEPARTMENTS_TABLE} (code, name, created_at, updated_at)
          values ($1, $2, now(), now())
          on conflict (code)
          do update set
            name = excluded.name,
            updated_at = now()
        `,
        [code, getDepartmentLabel(code)]
      );
    }

    for (const seeded of SEEDED_USERS) {
      const normalized = validateUserMutationInput({
        ...seeded,
        avatarUrl: seeded.avatarUrl ?? null
      });
      await client.query(
        `
          insert into ${USERS_TABLE} (
            first_name,
            last_name,
            display_name,
            email,
            normalized_email,
            job_title,
            department_code,
            role,
            status,
            avatar_url,
            phone,
            language,
            timezone,
            created_at,
            updated_at,
            last_login_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), null)
          on conflict (normalized_email)
          do update set
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            display_name = excluded.display_name,
            email = excluded.email,
            job_title = excluded.job_title,
            department_code = excluded.department_code,
            role = excluded.role,
            status = excluded.status,
            avatar_url = excluded.avatar_url,
            phone = excluded.phone,
            language = excluded.language,
            timezone = excluded.timezone,
            updated_at = now()
        `,
        [
          normalized.firstName,
          normalized.lastName,
          normalized.displayName,
          normalized.email,
          normalized.normalizedEmail,
          normalized.jobTitle,
          normalized.departmentCode,
          normalized.role,
          normalized.status,
          normalized.avatarUrl,
          normalized.phone,
          normalized.language,
          normalized.timezone
        ]
      );
    }

    const bobResult = await client.query<{ id: number | string }>(
      `
        select id
        from ${USERS_TABLE}
        where normalized_email = $1
        limit 1
      `,
      ["bob.durand@concept.local"]
    );
    const bobId = Number(bobResult.rows[0]?.id ?? 0);
    if (bobId > 0) {
      await client.query(
        `
          insert into ${RUNTIME_SETTINGS_TABLE} (setting_key, setting_value, updated_at)
          values ($1, $2::jsonb, now())
          on conflict (setting_key)
          do nothing
        `,
        [
          CURRENT_DEV_USER_SETTING_KEY,
          JSON.stringify({ userId: bobId })
        ]
      );
    }
  } finally {
    client.release();
  }
}

export async function ensureUserManagementSchema() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__usersSetupPromise) {
    globalWithPool.__usersSetupPromise = ensureSchemaInternal(pool).catch((error) => {
      globalWithPool.__usersSetupPromise = undefined;
      throw error;
    });
  }

  await globalWithPool.__usersSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureUserManagementSchema();
  return pool;
}

function buildUsersWhereClause(filters: UserListFilters) {
  const clauses: string[] = [];
  const values: Array<string> = [];

  if (filters.role && filters.role !== "all") {
    values.push(filters.role);
    clauses.push(`u.role = $${values.length}`);
  }

  if (filters.department && filters.department !== "all") {
    values.push(filters.department);
    clauses.push(`u.department_code = $${values.length}`);
  }

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    clauses.push(`u.status = $${values.length}`);
  }

  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim().toLowerCase()}%`);
    const index = values.length;
    clauses.push(`
      (
        lower(u.display_name) like $${index}
        or lower(u.email) like $${index}
        or lower(u.job_title) like $${index}
        or lower(d.name) like $${index}
      )
    `);
  }

  return {
    whereClause: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values
  };
}

async function listUsersWithClient(client: Pool | PoolClient, filters: UserListFilters = {}) {
  const { whereClause, values } = buildUsersWhereClause(filters);
  const result = await client.query<UserRow>(
    `
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
        d.name as department_name
      from ${USERS_TABLE} u
      inner join ${DEPARTMENTS_TABLE} d on d.code = u.department_code
      ${whereClause}
      order by lower(u.display_name) asc
    `,
    values
  );

  return result.rows.map(mapUserRow);
}

export async function listUsers(filters: UserListFilters = {}) {
  const pool = await requirePool();
  return listUsersWithClient(pool, filters);
}

export async function listDepartments() {
  const pool = await requirePool();
  const result = await pool.query<DepartmentRow>(
    `
      select code, name, created_at, updated_at
      from ${DEPARTMENTS_TABLE}
      order by name asc
    `
  );

  return result.rows.map(mapDepartmentRow);
}

export async function getUserById(id: number) {
  const pool = await requirePool();
  const result = await pool.query<UserRow>(
    `
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
        d.name as department_name
      from ${USERS_TABLE} u
      inner join ${DEPARTMENTS_TABLE} d on d.code = u.department_code
      where u.id = $1
      limit 1
    `,
    [id]
  );

  return result.rows[0] ? mapUserRow(result.rows[0]) : null;
}

export async function getUserByEmail(email: string) {
  const pool = await requirePool();
  const result = await pool.query<UserRow>(
    `
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
        d.name as department_name
      from ${USERS_TABLE} u
      inner join ${DEPARTMENTS_TABLE} d on d.code = u.department_code
      where u.normalized_email = lower(trim($1))
      limit 1
    `,
    [email]
  );

  return result.rows[0] ? mapUserRow(result.rows[0]) : null;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export async function createUser(input: UserMutationInput) {
  const pool = await requirePool();
  const normalized = validateUserMutationInput(input);

  try {
    const result = await pool.query<{ id: number | string }>(
      `
        insert into ${USERS_TABLE} (
          first_name,
          last_name,
          display_name,
          email,
          normalized_email,
          job_title,
          department_code,
          role,
          status,
          avatar_url,
          phone,
          language,
          timezone,
          created_at,
          updated_at,
          last_login_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), null)
        returning id
      `,
      [
        normalized.firstName,
        normalized.lastName,
        normalized.displayName,
        normalized.email,
        normalized.normalizedEmail,
        normalized.jobTitle,
        normalized.departmentCode,
        normalized.role,
        normalized.status,
        normalized.avatarUrl,
        normalized.phone,
        normalized.language,
        normalized.timezone
      ]
    );

    return getUserById(Number(result.rows[0]?.id ?? 0));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Un utilisateur avec cette adresse email existe deja.");
    }
    throw error;
  }
}

export async function updateUser(id: number, input: UserMutationInput) {
  const pool = await requirePool();
  const normalized = validateUserMutationInput(input);

  try {
    const result = await pool.query(
      `
        update ${USERS_TABLE}
        set
          first_name = $2,
          last_name = $3,
          display_name = $4,
          email = $5,
          normalized_email = $6,
          job_title = $7,
          department_code = $8,
          role = $9,
          status = $10,
          avatar_url = $11,
          phone = $12,
          language = $13,
          timezone = $14,
          updated_at = now()
        where id = $1
        returning id
      `,
      [
        id,
        normalized.firstName,
        normalized.lastName,
        normalized.displayName,
        normalized.email,
        normalized.normalizedEmail,
        normalized.jobTitle,
        normalized.departmentCode,
        normalized.role,
        normalized.status,
        normalized.avatarUrl,
        normalized.phone,
        normalized.language,
        normalized.timezone
      ]
    );

    if (!result.rows[0]) {
      return null;
    }

    return getUserById(id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Un utilisateur avec cette adresse email existe deja.");
    }
    throw error;
  }
}

export async function updateOwnProfile(userId: number, input: ProfileUpdateInput) {
  const pool = await requirePool();
  const normalized = validateProfileUpdateInput(input);

  try {
    const result = await pool.query(
      `
        update ${USERS_TABLE}
        set
          first_name = $2,
          last_name = $3,
          display_name = $4,
          email = $5,
          normalized_email = $6,
          job_title = $7,
          department_code = $8,
          avatar_url = $9,
          phone = $10,
          language = $11,
          timezone = $12,
          updated_at = now()
        where id = $1
        returning id
      `,
      [
        userId,
        normalized.firstName,
        normalized.lastName,
        normalized.displayName,
        normalized.email,
        normalized.normalizedEmail,
        normalized.jobTitle,
        normalized.departmentCode,
        normalized.avatarUrl,
        normalized.phone,
        normalized.language,
        normalized.timezone
      ]
    );

    if (!result.rows[0]) {
      return null;
    }

    return getUserById(userId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Un utilisateur avec cette adresse email existe deja.");
    }
    throw error;
  }
}

export async function setUserStatus(id: number, status: UserStatus) {
  const pool = await requirePool();
  const result = await pool.query(
    `
      update ${USERS_TABLE}
      set
        status = $2,
        updated_at = now()
      where id = $1
      returning id
    `,
    [id, status]
  );

  if (!result.rows[0]) {
    return null;
  }

  return getUserById(id);
}

export async function listDevelopmentUsers() {
  const users = await listUsers({ status: "all" });
  return users.map<DevelopmentUserOption>((user) => ({
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    departmentCode: user.departmentCode,
    departmentName: user.departmentName,
    role: user.role,
    status: user.status
  }));
}

export async function getCurrentDevelopmentUserId(client?: Pool | PoolClient) {
  const db = client ?? await requirePool();
  const result = await db.query<{ setting_value: { userId?: number } }>(
    `
      select setting_value
      from ${RUNTIME_SETTINGS_TABLE}
      where setting_key = $1
      limit 1
    `,
    [CURRENT_DEV_USER_SETTING_KEY]
  );

  return Number(result.rows[0]?.setting_value?.userId ?? 0) || null;
}

export async function setCurrentDevelopmentUser(userId: number) {
  const pool = await requirePool();
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("Utilisateur introuvable.");
  }

  await pool.query(
    `
      insert into ${RUNTIME_SETTINGS_TABLE} (setting_key, setting_value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (setting_key)
      do update set
        setting_value = excluded.setting_value,
        updated_at = now()
    `,
    [
      CURRENT_DEV_USER_SETTING_KEY,
      JSON.stringify({ userId })
    ]
  );

  return user;
}

export async function getCurrentDevelopmentUser() {
  const pool = await requirePool();
  const userId = await getCurrentDevelopmentUserId(pool);
  if (userId) {
    const selected = await getUserById(userId);
    if (selected) {
      return selected;
    }
  }

  const bob = await getUserByEmail("bob.durand@concept.local");
  if (!bob) {
    return null;
  }

  await setCurrentDevelopmentUser(bob.id);
  return bob;
}

export async function getDevelopmentUserState(): Promise<DevelopmentUserState> {
  const [currentUser, users] = await Promise.all([
    getCurrentDevelopmentUser(),
    listDevelopmentUsers()
  ]);

  if (!currentUser) {
    throw new Error("Aucun utilisateur de developpement n'est disponible.");
  }

  return {
    currentUserId: currentUser.id,
    users
  };
}

export async function closeUsersPool() {
  const globalWithPool = globalThis as GlobalWithPool;
  if (globalWithPool.__usersPool) {
    await globalWithPool.__usersPool.end();
    globalWithPool.__usersPool = undefined;
    globalWithPool.__usersSetupPromise = undefined;
  }
}
