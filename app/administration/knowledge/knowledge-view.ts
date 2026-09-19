// Pure view-resolution logic for the /administration/knowledge tabs.
// No I/O, no database, no RBAC - kept separate from page.tsx so it is
// trivially unit-testable without rendering or a database connection.

export const KNOWLEDGE_VIEWS = ["cdc", "archives"] as const;

export type KnowledgeView = (typeof KNOWLEDGE_VIEWS)[number];

export function resolveKnowledgeView(rawView: unknown): KnowledgeView {
  return rawView === "archives" ? "archives" : "cdc";
}
