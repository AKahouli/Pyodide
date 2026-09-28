import {
  BarChart3,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  ClipboardList,
  Code2,
  Database,
  FileText,
  Folder,
  Globe,
  Heart,
  LayoutDashboard,
  Lightbulb,
  Mail,
  Music,
  Palette,
  Rocket,
  Settings,
  ShoppingCart,
  Star,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Curated category icon set (lucide-react — the project's icon convention).
 * Keys are stable slugs persisted in `template_categories.icon`; the DB never
 * stores emoji. Unknown/empty values fall back to `LayoutDashboard`.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'bar-chart': BarChart3,
  'book-open': BookOpen,
  briefcase: Briefcase,
  calendar: Calendar,
  camera: Camera,
  'clipboard-list': ClipboardList,
  code: Code2,
  database: Database,
  'file-text': FileText,
  folder: Folder,
  globe: Globe,
  heart: Heart,
  dashboard: LayoutDashboard,
  lightbulb: Lightbulb,
  mail: Mail,
  music: Music,
  palette: Palette,
  rocket: Rocket,
  settings: Settings,
  'shopping-cart': ShoppingCart,
  star: Star,
  tag: Tag,
  users: Users,
  wallet: Wallet,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

const DEFAULT_ICON = LayoutDashboard;

interface CategoryIconProps {
  name?: string | null;
  className?: string;
}

export function CategoryIcon({ name, className }: CategoryIconProps) {
  const Icon = (name && CATEGORY_ICONS[name]) || DEFAULT_ICON;
  return <Icon className={className} aria-hidden />;
}
