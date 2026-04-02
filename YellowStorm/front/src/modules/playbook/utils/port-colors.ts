import type { ArtifactKind } from '../types';
import { FileText, FileType, Code, Image, Table2, Presentation, BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface PortColorEntry {
  bg: string;
  ring: string;
  dot: string;
  icon: LucideIcon;
}

export const PORT_COLORS: Record<ArtifactKind, PortColorEntry> = {
  text: { bg: 'bg-blue-100', ring: 'ring-blue-500/50', dot: 'bg-blue-500', icon: FileText },
  document: { bg: 'bg-indigo-100', ring: 'ring-indigo-500/50', dot: 'bg-indigo-500', icon: FileType },
  code: { bg: 'bg-green-100', ring: 'ring-green-500/50', dot: 'bg-green-500', icon: Code },
  image: { bg: 'bg-pink-100', ring: 'ring-pink-500/50', dot: 'bg-pink-500', icon: Image },
  data: { bg: 'bg-amber-100', ring: 'ring-amber-500/50', dot: 'bg-amber-500', icon: Table2 },
  slide_deck: { bg: 'bg-orange-100', ring: 'ring-orange-500/50', dot: 'bg-orange-500', icon: Presentation },
  dashboard: { bg: 'bg-purple-100', ring: 'ring-purple-500/50', dot: 'bg-purple-500', icon: BarChart3 },
};

export function getPortColor(kind: ArtifactKind): string {
  return PORT_COLORS[kind]?.dot || 'bg-muted';
}
