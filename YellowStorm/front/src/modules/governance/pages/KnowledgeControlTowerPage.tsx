import { KnowledgeActionCenter } from '../components/intelligence/KnowledgeActionCenter';

export function KnowledgeControlTowerPage({ programId, scopeId, onOpenDocument }: Readonly<{ programId: string | null; scopeId: string; onOpenDocument: (documentId: string) => void }>): JSX.Element {
  return <KnowledgeActionCenter programId={programId} scopeId={scopeId} onOpenDocument={onOpenDocument} />;
}
