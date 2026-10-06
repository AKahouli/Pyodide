import {
  AlarmClock,
  Aperture,
  Archive,
  AtSign,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bookmark,
  Bot,
  Briefcase,
  Brush,
  Building2,
  Calendar,
  CalendarCheck,
  CalendarClock,
  Camera,
  ClipboardList,
  Clock,
  Cloud,
  Code2,
  Coins,
  Cpu,
  CreditCard,
  Database,
  FileText,
  Files,
  Film,
  Flag,
  Folder,
  FolderOpen,
  Gift,
  GitBranch,
  Globe,
  Headphones,
  Heart,
  History,
  Hourglass,
  Image,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Mail,
  Megaphone,
  MessageSquare,
  Mic,
  Music,
  Package,
  Palette,
  Percent,
  Phone,
  Radio,
  Receipt,
  Repeat,
  Rocket,
  Rss,
  Send,
  Server,
  Settings,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  StickyNote,
  Store,
  Table2,
  Tag,
  Target,
  Terminal,
  Timer,
  TrendingUp,
  Truck,
  Users,
  Video,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Curated category icon set (lucide-react — the project's icon convention).
 * Keys are stable slugs persisted in `template_categories.icon`; the DB never
 * stores emoji. Unknown/empty values fall back to `LayoutDashboard`.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  star: Star,
  heart: Heart,
  bookmark: Bookmark,
  tag: Tag,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  rocket: Rocket,
  globe: Globe,
  flag: Flag,
  briefcase: Briefcase,
  users: Users,
  wallet: Wallet,
  'bar-chart': BarChart3,
  'trending-up': TrendingUp,
  building: Building2,
  target: Target,
  landmark: Landmark,
  award: Award,
  'file-text': FileText,
  files: Files,
  database: Database,
  'clipboard-list': ClipboardList,
  'book-open': BookOpen,
  archive: Archive,
  table: Table2,
  folder: Folder,
  'folder-open': FolderOpen,
  'sticky-note': StickyNote,
  mail: Mail,
  'message-square': MessageSquare,
  phone: Phone,
  send: Send,
  bell: Bell,
  'at-sign': AtSign,
  share: Share2,
  megaphone: Megaphone,
  rss: Rss,
  radio: Radio,
  camera: Camera,
  image: Image,
  music: Music,
  video: Video,
  film: Film,
  mic: Mic,
  headphones: Headphones,
  palette: Palette,
  aperture: Aperture,
  brush: Brush,
  code: Code2,
  terminal: Terminal,
  cpu: Cpu,
  server: Server,
  cloud: Cloud,
  'git-branch': GitBranch,
  settings: Settings,
  wrench: Wrench,
  bot: Bot,
  smartphone: Smartphone,
  'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag,
  'credit-card': CreditCard,
  store: Store,
  package: Package,
  receipt: Receipt,
  percent: Percent,
  truck: Truck,
  coins: Coins,
  gift: Gift,
  calendar: Calendar,
  clock: Clock,
  'alarm-clock': AlarmClock,
  timer: Timer,
  'calendar-check': CalendarCheck,
  'list-checks': ListChecks,
  repeat: Repeat,
  history: History,
  hourglass: Hourglass,
  'calendar-clock': CalendarClock,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** i18n key suffix under `categories.iconGroups` (must match en/fr locale keys). */
export type CategoryIconGroupKey =
  | 'general'
  | 'business'
  | 'files'
  | 'communication'
  | 'media'
  | 'technology'
  | 'commerce'
  | 'time';

export interface CategoryIconGroup {
  key: CategoryIconGroupKey;
  icons: string[];
}

/**
 * Ordered groups for the icon picker. Labels are translated at the call site
 * via `categories.iconGroups.<key>`; every icon listed here must exist in
 * `CATEGORY_ICONS`.
 */
export const CATEGORY_ICON_GROUPS: CategoryIconGroup[] = [
  {
    key: 'general',
    icons: ['dashboard', 'star', 'heart', 'bookmark', 'tag', 'lightbulb', 'sparkles', 'rocket', 'globe', 'flag'],
  },
  {
    key: 'business',
    icons: ['briefcase', 'users', 'wallet', 'bar-chart', 'trending-up', 'building', 'target', 'landmark', 'award'],
  },
  {
    key: 'files',
    icons: ['file-text', 'files', 'database', 'clipboard-list', 'book-open', 'archive', 'table', 'folder', 'folder-open', 'sticky-note'],
  },
  {
    key: 'communication',
    icons: ['mail', 'message-square', 'phone', 'send', 'bell', 'at-sign', 'share', 'megaphone', 'rss', 'radio'],
  },
  {
    key: 'media',
    icons: ['camera', 'image', 'music', 'video', 'film', 'mic', 'headphones', 'palette', 'aperture', 'brush'],
  },
  {
    key: 'technology',
    icons: ['code', 'terminal', 'cpu', 'server', 'cloud', 'git-branch', 'settings', 'wrench', 'bot', 'smartphone'],
  },
  {
    key: 'commerce',
    icons: ['shopping-cart', 'shopping-bag', 'credit-card', 'store', 'package', 'receipt', 'percent', 'truck', 'coins', 'gift'],
  },
  {
    key: 'time',
    icons: ['calendar', 'clock', 'alarm-clock', 'timer', 'calendar-check', 'list-checks', 'repeat', 'history', 'hourglass', 'calendar-clock'],
  },
];

const DEFAULT_ICON = LayoutDashboard;

interface CategoryIconProps {
  name?: string | null;
  className?: string;
}

export function CategoryIcon({ name, className }: CategoryIconProps) {
  const Icon = (name && CATEGORY_ICONS[name]) || DEFAULT_ICON;
  return <Icon className={className} aria-hidden />;
}
