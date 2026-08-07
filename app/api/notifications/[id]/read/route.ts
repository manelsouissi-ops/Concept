import { NextResponse } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { markNotificationRead } from "@/lib/notifications/service.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "dashboard");
  if (deniedResponse || !currentUser) {
    return deniedResponse;
  }

  const { id } = await params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId < 1) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_NOTIFICATION_ID",
          message: "Identifiant de notification invalide.",
          details: {}
        }
      },
      { status: 400 }
    );
  }

  const item = await markNotificationRead(currentUser, notificationId);
  return NextResponse.json({
    ok: true,
    data: item
  });
}

