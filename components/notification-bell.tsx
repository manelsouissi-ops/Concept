"use client";

import Link from "next/link";
import { useState } from "react";
import { BellIcon } from "./app-icons.tsx";
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  NotificationsClientError
} from "@/lib/notifications/client.ts";
import type { AppNotificationRecord } from "@/lib/notifications/types.ts";

type NotificationBellState = {
  items: AppNotificationRecord[];
  unreadCount: number;
};

function formatNotificationDate(value: string) {
  const createdAt = new Date(value);
  const now = Date.now();
  const deltaMinutes = Math.max(1, Math.round((now - createdAt.getTime()) / 60000));

  if (deltaMinutes < 60) {
    return `Il y a ${deltaMinutes} min`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `Il y a ${deltaHours} h`;
  }

  return createdAt.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof NotificationsClientError) {
    return error.message;
  }

  return "Les notifications n'ont pas pu etre mises a jour.";
}

export function NotificationBell({
  initialItems,
  initialUnreadCount
}: {
  initialItems: AppNotificationRecord[];
  initialUnreadCount: number;
}) {
  const [state, setState] = useState<NotificationBellState>({
    items: initialItems,
    unreadCount: initialUnreadCount
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleMarkRead(notificationId: number) {
    setIsPending(true);
    setError(null);
    try {
      await markNotificationAsRead(notificationId);
      setState((current) => ({
        items: current.items.map((item) =>
          item.id === notificationId ? { ...item, isRead: true } : item
        ),
        unreadCount: Math.max(
          0,
          current.unreadCount - (current.items.find((item) => item.id === notificationId && !item.isRead) ? 1 : 0)
        )
      }));
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsPending(false);
    }
  }

  async function handleMarkAllRead() {
    setIsPending(true);
    setError(null);
    try {
      await markAllNotificationsAsRead();
      setState((current) => ({
        items: current.items.map((item) => ({ ...item, isRead: true })),
        unreadCount: 0
      }));
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <details className="topbar-notification-menu">
      <summary className="topbar-icon-button" aria-label="Notifications">
        <BellIcon className="topbar-action-icon" />
        {state.unreadCount > 0 ? (
          <span className="topbar-notification-badge">{state.unreadCount}</span>
        ) : null}
      </summary>

      <div className="topbar-notification-content">
        <div className="topbar-notification-header">
          <div>
            <strong>Notifications</strong>
            <span>{state.unreadCount} non lue(s)</span>
          </div>
          <button
            type="button"
            className="topbar-user-menu-link topbar-user-menu-button"
            onClick={() => void handleMarkAllRead()}
            disabled={isPending || state.unreadCount === 0}
          >
            Tout marquer comme lu
          </button>
        </div>

        <div className="topbar-notification-list">
          {state.items.length > 0 ? (
            state.items.map((item) => (
              <article
                key={item.id}
                className={item.isRead ? "topbar-notification-item is-read" : "topbar-notification-item"}
              >
                <div className="topbar-notification-copy">
                  <strong>{item.title}</strong>
                  <p>{item.message}</p>
                  <small>{formatNotificationDate(item.createdAt)}</small>
                </div>
                <div className="topbar-notification-actions">
                  <Link href={item.actionUrl} className="topbar-user-menu-link">
                    Ouvrir
                  </Link>
                  {!item.isRead ? (
                    <button
                      type="button"
                      className="topbar-user-menu-link topbar-user-menu-button"
                      onClick={() => void handleMarkRead(item.id)}
                      disabled={isPending}
                    >
                      Lu
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="topbar-notification-empty">
              <strong>Aucune notification recente</strong>
              <span>Les prochaines mises a jour utiles apparaitront ici.</span>
            </div>
          )}
        </div>

        {error ? <div className="callout warning">{error}</div> : null}
      </div>
    </details>
  );
}
