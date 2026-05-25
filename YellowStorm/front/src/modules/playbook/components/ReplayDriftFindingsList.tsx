import { Badge } from '@/components/ui/badge';

interface ReplayDriftFindingItem {
  category: string;
  reason: string;
  severity: 'info' | 'warning' | 'fail';
  label: string;
}

interface ReplayDriftFindingsListProps {
  findings: ReplayDriftFindingItem[];
  findingTone: (severity: 'info' | 'warning' | 'fail') => string;
}

export function ReplayDriftFindingsList({ findings, findingTone }: ReplayDriftFindingsListProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {findings.map((finding, index) => (
        <Badge key={`${finding.category}-${finding.reason}-${index}`} variant="outline" className={findingTone(finding.severity)}>
          {finding.label}
        </Badge>
      ))}
    </div>
  );
}
