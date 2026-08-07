import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell.tsx";
import { getOptionalCurrentUserFromServerHeaders } from "@/lib/auth/current-user.ts";
import { buildUserPresentation } from "@/lib/auth/rbac.ts";
import {
  getUnreadNotificationCount,
  listNotificationsForUser
} from "@/lib/notifications/service.ts";
import type { AppNotificationRecord } from "@/lib/notifications/types.ts";
import { getDevelopmentUserState } from "@/lib/users/repository.ts";
import { headers } from "next/headers";
import { isProtectedPagePath, isPublicPagePath } from "@/lib/auth/paths.ts";
import { redirect } from "next/navigation";
import { isDevelopmentUserSwitcherEnabled } from "@/lib/auth/config.ts";

export const metadata = {
  title: "CONCEPT | Gestion intelligente des appels d'offres",
  description: "Plateforme interne de pilotage des appels d'offres, documents et Fiches CDC."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const requestHeaders = await headers();
  const requestPath = requestHeaders.get("x-concept-request-path") ?? "/";
  const pathname = requestPath.split("?")[0] ?? requestPath;
  const isPublicPath = isPublicPagePath(pathname);

  if (isPublicPath) {
    return (
      <html lang="fr">
        <body>{children}</body>
      </html>
    );
  }

  const currentUserRecord = await getOptionalCurrentUserFromServerHeaders();
  const currentUser = currentUserRecord ? buildUserPresentation(currentUserRecord) : null;
  const isDevelopmentMode = process.env.NODE_ENV === "development";
  const devSwitcherEnabled = isDevelopmentUserSwitcherEnabled();
  let developmentUserState = null;
  let initialNotifications: AppNotificationRecord[] = [];
  let initialUnreadNotificationCount = 0;

  if (!currentUser && isProtectedPagePath(pathname)) {
    redirect(`/login?next=${encodeURIComponent(requestPath)}`);
  }

  if (currentUser && currentUser.role === "ADMIN" && isDevelopmentMode && devSwitcherEnabled) {
    try {
      developmentUserState = await getDevelopmentUserState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[identity] Development user switcher unavailable: ${message}`);
    }
  }

  if (currentUserRecord && currentUserRecord.role !== "ADMIN") {
    try {
      [initialNotifications, initialUnreadNotificationCount] = await Promise.all([
        listNotificationsForUser(currentUserRecord, 8),
        getUnreadNotificationCount(currentUserRecord)
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[notifications] Initial notification load failed: ${message}`);
    }
  }

  return (
    <html lang="fr">
      <body>
        <AppShell
          currentUser={currentUser}
          developmentUserState={developmentUserState}
          isDevelopmentMode={isDevelopmentMode && devSwitcherEnabled}
          initialNotifications={initialNotifications}
          initialUnreadNotificationCount={initialUnreadNotificationCount}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
