import test from "node:test";
import assert from "node:assert/strict";
import {
  filterNavigationByRole,
  getAdminNavigationSections,
  isActiveNavigationPath,
  type NavigationItemDefinition
} from "./navigation.ts";

const SAMPLE_SIDEBAR_ITEMS: NavigationItemDefinition[] = [
  { label: "Tableau de bord", href: "/dashboard", iconKey: "dashboard", area: "dashboard" },
  { label: "Appels d'offres", href: "/appels-offres", iconKey: "folder", area: "appels_offres" },
  { label: "Administration", href: "/administration", iconKey: "settings", area: "administration" },
  { label: "Utilisateurs", href: "/administration/utilisateurs", iconKey: "user", area: "administration" },
  { label: "Referentiels", iconKey: "library", disabled: true, area: "administration" }
];

test("admin sidebar exposes only technical navigation groups", () => {
  const sections = getAdminNavigationSections();
  const hrefs = sections.flatMap((section) => section.items.map((item) => item.href));

  assert.deepEqual(
    sections.map((section) => section.label),
    ["Administration", "Gestion", "Configuration", "Compte"]
  );
  assert.equal(hrefs.includes("/administration"), true);
  assert.equal(hrefs.includes("/administration/utilisateurs"), true);
  assert.equal(hrefs.includes("/administration/logiciels"), true);
  assert.equal(hrefs.includes("/settings"), true);
  assert.equal(hrefs.includes("/profile"), true);
  assert.equal(hrefs.includes("/dashboard"), false);
  assert.equal(hrefs.includes("/appels-offres"), false);
});

test("admin navigation active route matching keeps the current technical page highlighted", () => {
  assert.equal(isActiveNavigationPath("/administration", "/administration"), true);
  assert.equal(
    isActiveNavigationPath("/administration/utilisateurs/nouveau", "/administration/utilisateurs"),
    true
  );
  assert.equal(isActiveNavigationPath("/dashboard", "/administration"), false);
  assert.equal(
    isActiveNavigationPath("/dashboard", "/dashboard?section=dossiers", "section=dossiers"),
    true
  );
  assert.equal(
    isActiveNavigationPath("/dashboard", "/dashboard?section=modules", "section=dossiers"),
    false
  );
});

test("business roles never receive Administration nav items, not even disabled", () => {
  for (const role of ["COMMERCIAL", "FINANCE", "OPERATIONS", "DIRECTION_GENERALE"] as const) {
    const visible = filterNavigationByRole(SAMPLE_SIDEBAR_ITEMS, role);
    const labels = visible.map((item) => item.label);

    assert.deepEqual(labels, ["Tableau de bord", "Appels d'offres"]);
    assert.equal(labels.includes("Administration"), false);
    assert.equal(labels.includes("Utilisateurs"), false);
    assert.equal(labels.includes("Referentiels"), false);
  }
});

test("ADMIN sees Administration nav items but not the business primary nav", () => {
  const visible = filterNavigationByRole(SAMPLE_SIDEBAR_ITEMS, "ADMIN");
  const labels = visible.map((item) => item.label);

  assert.deepEqual(labels, ["Administration", "Utilisateurs", "Referentiels"]);
  assert.equal(labels.includes("Tableau de bord"), false);
  assert.equal(labels.includes("Appels d'offres"), false);
});
