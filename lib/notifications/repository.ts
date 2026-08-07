import { Pool } from "pg";
import { ensureAppelsOffresSchema } from "../appels-offres/repository.ts";
import { ensureUserManagementSchema } from "../users/repository.ts";
import type { UserRole } from "../auth/rbac.ts";
import type {
  AppNotificationRecord,
  BusinessNotificationEventType,
  CreateAppNotificationInput
} from "./types.ts";

const NOTIFICATIONS_TABLE = "public.app_notifications";

type GlobalWithPool = typeof globalThis & {
  __notificationsPool?: Pool;
  __notificationsSetupPromise?: Promise<void>;
};

type AppNotificationRow = {
  id: number | string;
  recipient_user_id: number | string;
  recipient_role: UserRole | null;
  appel_offre_code: string;
  module_code: string | null;
  event_type: BusinessNotificationEventType;
  title: string;
  message: string;
  action_url: string;
  is_read: boolean;
  read_at: string | Date | null;
  created_at: string | Date;
  actor_user_id: number | string | null;
  metadata: Record<string, unknown> | null;
  dedupe_key: string | null;
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
  if (!globalWithPool.__notificationsPool) {
    globalWithPool.__notificationsPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__notificationsPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapNotificationRow(row: AppNotificationRow): AppNotificationRecord {
  return {
    id: Number(row.id),
    recipientUserId: Number(row.recipient_user_id),
    recipientRole: row.recipient_role,
    appelOffreCode: row.appel_offre_code,
    moduleCode: row.module_code as AppNotificationRecord["moduleCode"],
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    actionUrl: row.action_url,
    isRead: row.is_read,
    readAt: normalizeTimestamp(row.read_at),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    metadata: row.metadata,
    dedupeKey: row.dedupe_key
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${NOTIFICATIONS_TABLE} (
        id bigserial primary key,
        recipient_user_id bigint not null references public.app_users(id) on delete cascade,
        recipient_role text null,
        appel_offre_code text not null,
        module_code text null,
        event_type text not null,
        title text not null,
        message text not null,
        action_url text not null,
        is_read boolean not null default false,
        read_at timestamptz null,
        created_at timestamptz not null default now(),
        actor_user_id bigint null references public.app_users(id) on delete set null,
        metadata jsonb null,
        dedupe_key text null
      )
    `);
    await client.query(`
      create index if not exists app_notifications_recipient_idx
      on ${NOTIFICATIONS_TABLE} (recipient_user_id, created_at desc)
    `);
    await client.query(`
      create index if not exists app_notifications_unread_idx
      on ${NOTIFICATIONS_TABLE} (recipient_user_id, is_read, created_at desc)
    `);
    await client.query(`
      create unique index if not exists app_notifications_dedupe_key_uidx
      on ${NOTIFICATIONS_TABLE} (dedupe_key)
      where dedupe_key is not null
    `);
  } finally {
    client.release();
  }
}

export async function ensureNotificationsSchema() {
  await ensureAppelsOffresSchema();
  await ensureUserManagementSchema();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__notificationsSetupPromise) {
    globalWithPool.__notificationsSetupPromise = ensureSchemaInternal(pool).catch((error) => {
      globalWithPool.__notificationsSetupPromise = undefined;
      throw error;
    });
  }

  await globalWithPool.__notificationsSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureNotificationsSchema();
  return pool;
}

export async function insertAppNotification(input: CreateAppNotificationInput) {
  const pool = await requirePool();
  const result = await pool.query<AppNotificationRow>(
    `
      insert into ${NOTIFICATIONS_TABLE} (
        recipient_user_id,
        recipient_role,
        appel_offre_code,
        module_code,
        event_type,
        title,
        message,
        action_url,
        is_read,
        read_at,
        created_at,
        actor_user_id,
        metadata,
        dedupe_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, false, null, now(), $9, $10::jsonb, $11)
      on conflict (dedupe_key)
      where dedupe_key is not null
      do update set
        recipient_user_id = excluded.recipient_user_id
      returning
        id,
        recipient_user_id,
        recipient_role,
        appel_offre_code,
        module_code,
        event_type,
        title,
        message,
        action_url,
        is_read,
        read_at,
        created_at,
        actor_user_id,
        metadata,
        dedupe_key
    `,
    [
      input.recipientUserId,
      input.recipientRole ?? null,
      input.appelOffreCode,
      input.moduleCode ?? null,
      input.eventType,
      input.title,
      input.message,
      input.actionUrl,
      input.actorUserId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.dedupeKey ?? null
    ]
  );

  return mapNotificationRow(result.rows[0]);
}

export async function listAppNotificationsForUser(recipientUserId: number, limit = 8) {
  const pool = await requirePool();
  const result = await pool.query<AppNotificationRow>(
    `
      select
        id,
        recipient_user_id,
        recipient_role,
        appel_offre_code,
        module_code,
        event_type,
        title,
        message,
        action_url,
        is_read,
        read_at,
        created_at,
        actor_user_id,
        metadata,
        dedupe_key
      from ${NOTIFICATIONS_TABLE}
      where recipient_user_id = $1
      order by created_at desc, id desc
      limit $2
    `,
    [recipientUserId, limit]
  );

  return result.rows.map(mapNotificationRow);
}

export async function listUnreadAppNotificationsForUser(recipientUserId: number) {
  const pool = await requirePool();
  const result = await pool.query<{ unread_count: number | string }>(
    `
      select count(*)::bigint as unread_count
      from ${NOTIFICATIONS_TABLE}
      where recipient_user_id = $1
        and is_read = false
    `,
    [recipientUserId]
  );

  return Number(result.rows[0]?.unread_count ?? 0);
}

export async function markAppNotificationRead(notificationId: number, recipientUserId: number) {
  const pool = await requirePool();
  const result = await pool.query<AppNotificationRow>(
    `
      update ${NOTIFICATIONS_TABLE}
      set
        is_read = true,
        read_at = coalesce(read_at, now())
      where id = $1
        and recipient_user_id = $2
      returning
        id,
        recipient_user_id,
        recipient_role,
        appel_offre_code,
        module_code,
        event_type,
        title,
        message,
        action_url,
        is_read,
        read_at,
        created_at,
        actor_user_id,
        metadata,
        dedupe_key
    `,
    [notificationId, recipientUserId]
  );

  return result.rows[0] ? mapNotificationRow(result.rows[0]) : null;
}

export async function markAllAppNotificationsRead(recipientUserId: number) {
  const pool = await requirePool();
  const result = await pool.query<{ id: number | string }>(
    `
      update ${NOTIFICATIONS_TABLE}
      set
        is_read = true,
        read_at = coalesce(read_at, now())
      where recipient_user_id = $1
        and is_read = false
      returning id
    `,
    [recipientUserId]
  );

  return result.rowCount ?? result.rows.length;
}

export async function getLatestNotificationByDedupeKey(dedupeKey: string) {
  const pool = await requirePool();
  const result = await pool.query<AppNotificationRow>(
    `
      select
        id,
        recipient_user_id,
        recipient_role,
        appel_offre_code,
        module_code,
        event_type,
        title,
        message,
        action_url,
        is_read,
        read_at,
        created_at,
        actor_user_id,
        metadata,
        dedupe_key
      from ${NOTIFICATIONS_TABLE}
      where dedupe_key = $1
      limit 1
    `,
    [dedupeKey]
  );

  return result.rows[0] ? mapNotificationRow(result.rows[0]) : null;
}

export async function closeNotificationsPool() {
  const globalWithPool = globalThis as GlobalWithPool;
  if (globalWithPool.__notificationsPool) {
    await globalWithPool.__notificationsPool.end();
    globalWithPool.__notificationsPool = undefined;
    globalWithPool.__notificationsSetupPromise = undefined;
  }
}

