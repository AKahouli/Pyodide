import { Badge } from '@/components/ui/badge';

interface ReplayConfidenceBadgeProps {
  label: string;
  value: string;
  tone?: string;
}

export function ReplayConfidenceBadge({ label, value, tone }: ReplayConfidenceBadgeProps) {
  return (
    <Badge variant="outline" className={tone}>
      {label}: {value}
    </Badge>
  );
}
