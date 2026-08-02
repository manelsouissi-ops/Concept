import { PageHeader } from "@/components/page-header.tsx";
import { SettingsPlaceholder } from "@/components/settings-placeholder.tsx";
import { SETTINGS_SECTIONS } from "@/lib/users/settings.ts";

export default function SettingsGeneralPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Parametres generaux"
        description="Ce socle accueillera les reglages transverses de la plateforme, de l'organisation et des preferences globales."
      />

      <SettingsPlaceholder
        title="Reglages generaux"
        description="Le module est pret a recevoir les futurs parametres organisationnels et les options de personnalisation globales."
        activeSection="/settings/general"
        sections={SETTINGS_SECTIONS}
      />
    </div>
  );
}
