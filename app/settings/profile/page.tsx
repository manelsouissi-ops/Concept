import { PageHeader } from "@/components/page-header.tsx";
import { SettingsPlaceholder } from "@/components/settings-placeholder.tsx";
import { SETTINGS_SECTIONS } from "@/lib/users/settings.ts";

export default function SettingsProfilePage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Preferences de profil"
        description="Retrouvez ici les reglages lies a l'identite, a l'affichage et au confort personnel."
      />

      <SettingsPlaceholder
        title="Preferences de profil"
        description="Cette section completement l'espace Mon profil avec les futurs reglages d'affichage, langue et experience utilisateur."
        activeSection="/settings/profile"
        sections={SETTINGS_SECTIONS}
      />
    </div>
  );
}
