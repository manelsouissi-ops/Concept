import { NextResponse } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { markAllNotificationsRead } from "@/lib/notifications/service.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "dashboard");
  if (deniedResponse || !currentUser) {
    return deniedResponse;
  }

  const updatedCount = await markAllNotificationsRead(currentUser);
  return NextResponse.json({
    ok: true,
    data: { updated_count: updatedCount }
  });
}

