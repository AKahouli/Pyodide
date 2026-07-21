import { KnowledgeActionCenter } from '../components/intelligence/KnowledgeActionCenter';

export function KnowledgeControlTowerPage({ programId, scopeId, onOpenSource }: Readonly<{ programId: string | null; scopeId: string; onOpenSource: (sourceId: string) => void }>): JSX.Element {
  return <KnowledgeActionCenter programId={programId} scopeId={scopeId} onOpenSource={onOpenSource} />;
}
