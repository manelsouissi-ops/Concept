import { NextResponse } from "next/server";
import {
  getUnreadNotificationCount,
  listNotificationsForUser
} from "@/lib/notifications/service.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "dashboard");
  if (deniedResponse || !currentUser) {
    return deniedResponse;
  }

  const [items, unreadCount] = await Promise.all([
    listNotificationsForUser(currentUser, 12),
    getUnreadNotificationCount(currentUser)
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      items,
      unread_count: unreadCount
    }
  });
}

