export const SETTINGS_SECTIONS = [
  {
    label: "General",
    href: "/settings/general",
    description: "Preferences globales, organisation et comportement par defaut de la plateforme."
  },
  {
    label: "Profil",
    href: "/settings/profile",
    description: "Raccourcis vers les informations personnelles et les preferences de presentation."
  },
  {
    label: "Notifications",
    href: "/settings/notifications",
    description: "Canaux, seuils et regles de notification pour les dossiers et les FCIs."
  },
  {
    label: "Securite",
    href: "/settings/security",
    description: "Preparation de l'authentification, des sessions et des controles d'acces avances.",
    comingSoon: true
  }
] as const;
