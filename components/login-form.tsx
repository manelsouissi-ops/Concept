"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "./brand-logo.tsx";
import { getSafeRedirectTarget } from "@/lib/auth/paths.ts";

type LoginResponse =
  | {
      ok: true;
      redirect_to: string;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export function LoginForm({
  requestedDestination
}: {
  requestedDestination: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password,
          next: requestedDestination
        })
      });
      const payload = (await response.json()) as LoginResponse;

      if (!response.ok || !payload.ok) {
        setError(
          "error" in payload
            ? payload.error.message
            : "La connexion a échoué."
        );
        return;
      }

      const redirectTo = getSafeRedirectTarget(payload.redirect_to, "/dashboard");
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("La connexion a échoué.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-label="Connexion à la plateforme CONCEPT">
        <div className="auth-card-brand">
          <BrandLogo priority showCopy={false} />
        </div>

        <div className="auth-card-copy">
          <span className="eyebrow">CONCEPT</span>
          <h1>Se connecter</h1>
          <p>Accédez à la plateforme CONCEPT.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              disabled={isPending}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Mot de passe</label>
            <input
              id="login-password"
              className="input"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              disabled={isPending}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <label className="checkbox auth-checkbox">
            <input
              type="checkbox"
              checked={showPassword}
              disabled={isPending}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            <span>Afficher le mot de passe</span>
          </label>

          {error ? <div className="callout warning">{error}</div> : null}

          <button className="button button-primary auth-submit" type="submit" disabled={isPending}>
            {isPending ? "Connexion en cours…" : "Se connecter"}
          </button>
        </form>
      </section>
    </main>
  );
}
