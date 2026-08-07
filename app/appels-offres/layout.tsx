import type { ReactNode } from "react";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

// Same reasoning as app/dashboard/layout.tsx: this subtree has loading.tsx
// boundaries (root, nouveau, [code]), which stream a 200 shell before a
// page-level redirect() could take effect. Gating here, above every
// descendant Suspense boundary, makes the redirect commit correctly.
export default async function AppelsOffresLayout({ children }: { children: ReactNode }) {
  await requireAreaAccessForPage("appels_offres");
  return children;
}
