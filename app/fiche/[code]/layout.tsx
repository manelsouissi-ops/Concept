import type { ReactNode } from "react";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

// Same reasoning as app/dashboard/layout.tsx: this segment has a sibling
// loading.tsx, which streams a 200 shell before a page-level redirect()
// could take effect.
export default async function FicheLayout({ children }: { children: ReactNode }) {
  await requireAreaAccessForPage("appels_offres");
  return children;
}
