import { redirect } from "next/navigation";
import { getOptionalCurrentUserFromServerHeaders } from "@/lib/auth/current-user.ts";
import { getDefaultAuthenticatedPath } from "@/lib/auth/rbac.ts";

export default async function HomePage() {
  const currentUser = await getOptionalCurrentUserFromServerHeaders();
  redirect(currentUser ? getDefaultAuthenticatedPath(currentUser.role) : "/login");
}
