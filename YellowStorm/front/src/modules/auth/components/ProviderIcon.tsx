import { KeyRound } from 'lucide-react';
import { Icons } from '@/components/icons';

interface ProviderIconProps {
  iconKey: string;
  className?: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  microsoft: Icons.microsoft,
  google: Icons.google,
  github: Icons.gitHub,
  okta: Icons.okta,
};

export function ProviderIcon({ iconKey, className = 'h-5 w-5' }: ProviderIconProps) {
  const IconComponent = iconMap[iconKey.toLowerCase()];

  if (IconComponent) {
    return <IconComponent className={className} />;
  }

  return <KeyRound className={className} />;
}
