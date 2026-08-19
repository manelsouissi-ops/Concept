import assert from "node:assert/strict";
import test from "node:test";
import { mergeNotificationRefresh } from "./client-state.ts";
import type { AppNotificationRecord } from "./types.ts";

function notification(id: number, isRead = false): AppNotificationRecord {
  return {
    id,
    recipientUserId: 1,
    recipientRole: "COMMERCIAL",
    appelOffreCode: `AO-${id}`,
    moduleCode: null,
    eventType: "FICHE_CDC_READY",
    title: "Fiche CDC prête à vérifier",
    message: "fixture",
    actionUrl: `/appels-offres/AO-${id}/fiche-cdc`,
    isRead,
    readAt: null,
    createdAt: "2026-08-18T12:00:00.000Z",
    actorUserId: null,
    metadata: null,
    dedupeKey: `fixture-${id}`
  };
}

test("poll refresh replaces recent items and unread count", () => {
  const result = mergeNotificationRefresh(
    { items: [notification(2), notification(1, true)], unreadCount: 5 },
    new Set()
  );
  assert.deepEqual(result.items.map((item) => item.id), [2, 1]);
  assert.equal(result.unreadCount, 5);
});

test("stale polling cannot resurrect a locally marked-read notification", () => {
  const result = mergeNotificationRefresh(
    { items: [notification(2), notification(1)], unreadCount: 2 },
    new Set([1])
  );
  assert.equal(result.items.find((item) => item.id === 1)?.isRead, true);
  assert.equal(result.unreadCount, 1);
});
