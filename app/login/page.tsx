import { LoginForm } from "@/components/login-form.tsx";
import { redirectAuthenticatedUserAwayFromLogin } from "@/lib/auth/current-user.ts";
import { ensureAuthenticationSchema } from "@/lib/auth/repository.ts";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await ensureAuthenticationSchema();
  const params = await searchParams;
  await redirectAuthenticatedUserAwayFromLogin(params.next);

  return <LoginForm requestedDestination={params.next ?? null} />;
}
