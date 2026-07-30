import { EmptyState } from "@/components/empty-state.tsx";

export function FciEmptyState({
  onInitialize
}: {
  onInitialize: () => void;
}) {
  return (
    <EmptyState
      title="FCI non initialisée"
      description="Initialisez la Fiche Contexte Interne pour préparer les quatre formulaires départementaux depuis la Fiche CDC validée."
      action={
        <button type="button" className="button button-primary" onClick={onInitialize}>
          Initialiser la FCI
        </button>
      }
    />
  );
}
