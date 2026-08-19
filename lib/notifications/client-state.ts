import type { AppNotificationRecord } from "./types.ts";

export type NotificationClientState = {
  items: AppNotificationRecord[];
  unreadCount: number;
};

export function mergeNotificationRefresh(
  incoming: NotificationClientState,
  locallyReadIds: ReadonlySet<number>
): NotificationClientState {
  let locallyReadIncomingCount = 0;
  const items = incoming.items.map((item) => {
    if (!item.isRead && locallyReadIds.has(item.id)) {
      locallyReadIncomingCount += 1;
      return { ...item, isRead: true };
    }
    return item;
  });

  return {
    items,
    unreadCount: Math.max(0, incoming.unreadCount - locallyReadIncomingCount)
  };
}
