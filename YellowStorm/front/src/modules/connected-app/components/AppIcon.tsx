import { memo } from 'react';
import { Cloud, Mail, HardDrive, Github, Plug } from 'lucide-react';

interface AppIconProps {
  iconKey: string;
  className?: string;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'google-drive': HardDrive,
  'microsoft': Cloud,
  'outlook': Mail,
  'sharepoint': Cloud,
  'github': Github,
};

export const AppIcon = memo(function AppIcon({ iconKey, className }: AppIconProps) {
  const Icon = ICON_MAP[iconKey] || Plug;
  return <Icon className={className} />;
});
