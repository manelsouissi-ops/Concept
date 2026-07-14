import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell.tsx";

export const metadata = {
  title: "CONCEPT | Gestion intelligente des appels d'offres",
  description: "Plateforme interne de pilotage des appels d'offres, documents et Fiches CDC."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
