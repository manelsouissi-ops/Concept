import { PageHeader } from "@/components/page-header.tsx";
import { SettingsPlaceholder } from "@/components/settings-placeholder.tsx";
import { SETTINGS_SECTIONS } from "@/lib/users/settings.ts";

export default function SettingsPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Parametres"
        description="Centralisez les reglages utilisateur et les futurs parametres transverses de la plateforme."
      />

      <SettingsPlaceholder
        title="Vue d'ensemble des parametres"
        description="Les espaces ci-dessous preparent l'arrivee de l'authentification, des notifications personnalisees et des preferences globales."
        activeSection="/settings"
        sections={SETTINGS_SECTIONS}
      />
    </div>
  );
}
