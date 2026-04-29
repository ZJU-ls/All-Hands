/**
 * allhands · <Icon> · business-icon wrapper around lucide-react.
 *
 * Contract (ADR 0016 §D1):
 *   - All business icons MUST route through this wrapper.
 *   - Direct `import { X } from 'lucide-react'` in feature code is banned
 *     (covered by the static contract scan).
 *   - Swap the underlying library (e.g. to phosphor) by changing only this
 *     file + the registry.
 *
 * Adding a new icon:
 *   1. Import the lucide component below.
 *   2. Add a kebab-case key to `registry`.
 *   3. Use via `<Icon name="new-name" />` anywhere.
 *
 * Special glyphs (app logo · provider brand marks · decorative chars) stay
 * in `web/components/icons/` and `<BrandMark />` — not here.
 */

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleHelp,
  Clock,
  Code,
  Command,
  Copy,
  Database,
  Download,
  Edit,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileCode2,
  FileText,
  Filter,
  Folder,
  Home,
  Image as ImageIcon,
  Info,
  Languages,
  Paperclip,
  Video,
  Volume2,
  LayoutGrid,
  Link,
  List,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  MessageSquare,
  Minimize2,
  Minus,
  Moon,
  MoreHorizontal,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  PlayCircle,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Sun,
  Table,
  Tag,
  Terminal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlock,
  Upload,
  User,
  UserPlus,
  Users,
  WandSparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Kebab-case icon name. Keys define the public API — rename behaviour here
 * breaks every caller, so treat additions as append-only where possible. */
const registry = {
  activity: Activity,
  "alert-circle": AlertCircle,
  "alert-triangle": AlertTriangle,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  bell: Bell,
  "book-open": BookOpen,
  brain: Brain,
  calendar: Calendar,
  check: Check,
  "check-circle-2": CheckCircle2,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevrons-up-down": ChevronsUpDown,
  "circle-help": CircleHelp,
  clock: Clock,
  code: Code,
  command: Command,
  copy: Copy,
  database: Database,
  download: Download,
  edit: Edit,
  "external-link": ExternalLink,
  eye: Eye,
  "eye-off": EyeOff,
  file: File,
  "file-code-2": FileCode2,
  "file-text": FileText,
  filter: Filter,
  folder: Folder,
  home: Home,
  image: ImageIcon,
  info: Info,
  languages: Languages,
  "layout-grid": LayoutGrid,
  link: Link,
  paperclip: Paperclip,
  video: Video,
  audio: Volume2,
  list: List,
  loader: Loader2,
  lock: Lock,
  "log-out": LogOut,
  mail: Mail,
  maximize: Maximize2,
  menu: Menu,
  "message-square": MessageSquare,
  minimize: Minimize2,
  minus: Minus,
  moon: Moon,
  "more-horizontal": MoreHorizontal,
  "more-vertical": MoreVertical,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  pause: Pause,
  play: Play,
  "play-circle": PlayCircle,
  plug: Plug,
  plus: Plus,
  power: Power,
  refresh: RefreshCw,
  save: Save,
  search: Search,
  send: Send,
  server: Server,
  settings: Settings,
  "share-2": Share2,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  store: Store,
  sun: Sun,
  table: Table,
  tag: Tag,
  terminal: Terminal,
  "trash-2": Trash2,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
  unlock: Unlock,
  upload: Upload,
  user: User,
  "user-plus": UserPlus,
  users: Users,
  "wand-2": WandSparkles,
  x: X,
  zap: Zap,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof registry;

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  /** Pixel size. Default 16 matches body line-height cap-height. */
  size?: number;
  /** Stroke width. 1.75 is the brand-blue default (slightly lighter than
   * lucide's 2) — tune per surface if needed. */
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...rest
}: IconProps) {
  const Glyph = registry[name];
  if (!Glyph) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[Icon] unknown name "${name}" — register it in components/ui/icon.tsx`);
    }
    return null;
  }
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
      {...rest}
    />
  );
}

/** Export the registry keys so tests + tooling can enumerate available icons. */
export const availableIconNames = Object.keys(registry) as IconName[];
