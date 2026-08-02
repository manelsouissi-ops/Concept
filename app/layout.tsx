import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell.tsx";
import { resolveCurrentUserFromServerHeaders } from "@/lib/auth/current-user.ts";
import { buildUserPresentation } from "@/lib/auth/rbac.ts";
import { getDevelopmentUserState } from "@/lib/users/repository.ts";

export const metadata = {
  title: "CONCEPT | Gestion intelligente des appels d'offres",
  description: "Plateforme interne de pilotage des appels d'offres, documents et Fiches CDC."
};

export default async function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const currentUser = buildUserPresentation(await resolveCurrentUserFromServerHeaders());
  const isDevelopmentMode = process.env.NODE_ENV !== "production";
  let developmentUserState = null;

  if (isDevelopmentMode) {
    try {
      developmentUserState = await getDevelopmentUserState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[identity] Development user switcher unavailable: ${message}`);
    }
  }

  return (
    <html lang="fr">
      <body>
        <AppShell
          currentUser={currentUser}
          developmentUserState={developmentUserState}
          isDevelopmentMode={isDevelopmentMode}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
