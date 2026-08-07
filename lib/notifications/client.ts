import type { AppNotificationRecord } from "./types.ts";

type NotificationsResponse = {
  items: AppNotificationRecord[];
  unread_count: number;
};

export class NotificationsClientError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NotificationsClientError";
    this.code = code;
    this.status = status;
  }
}

async function parseResponse<TData>(response: Response) {
  const payload = (await response.json()) as
    | { ok: true; data: TData }
    | { ok: false; error: { code: string; message: string } };

  if (!response.ok || !payload.ok) {
    const error = "error" in payload ? payload.error : {
      code: "NOTIFICATIONS_HTTP_ERROR",
      message: "Erreur de notifications."
    };
    throw new NotificationsClientError(response.status, error.code, error.message);
  }

  return payload.data;
}

export async function getNotifications() {
  const response = await fetch("/api/notifications", {
    cache: "no-store"
  });

  return parseResponse<NotificationsResponse>(response);
}

export async function markNotificationAsRead(notificationId: number) {
  const response = await fetch(`/api/notifications/${notificationId}/read`, {
    method: "POST"
  });

  return parseResponse<AppNotificationRecord | null>(response);
}

export async function markAllNotificationsAsRead() {
  const response = await fetch("/api/notifications/read-all", {
    method: "POST"
  });

  return parseResponse<{ updated_count: number }>(response);
}

