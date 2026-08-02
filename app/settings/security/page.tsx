import { PageHeader } from "@/components/page-header.tsx";
import { SettingsPlaceholder } from "@/components/settings-placeholder.tsx";
import { SETTINGS_SECTIONS } from "@/lib/users/settings.ts";

export default function SettingsSecurityPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Securite"
        description="Cette zone prepare l'arrivee de l'authentification, des sessions, des politiques de mot de passe et du SSO."
      />

      <SettingsPlaceholder
        title="Securite a venir"
        description="Les fondations du profil et des roles sont pretes. L'authentification et les controles de securite avances seront branches ici lors du prochain jalon."
        activeSection="/settings/security"
        sections={SETTINGS_SECTIONS}
      />
    </div>
  );
}
