import {
  ArrowRight, ArrowUpRight, BookOpen, BrainCircuit, Calculator, Calendar, ChartColumn, Check, CircleAlert, CircleCheck, ClipboardCheck, Database, FilePenLine,
  FileText, FlaskConical, Info, Library, Lock, Search, ShieldCheck, TriangleAlert, Users, type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

// One meaning, one icon, everywhere. Pick an icon here by what it stands for, so the same idea never has two different pictures.
export const ICONS = {
  protocol: FlaskConical,        // research protocol design
  literature: BookOpen,          // literature discovery
  sampleSize: Calculator,        // sample size
  statistics: ChartColumn,       // statistical analysis
  references: Library,           // reference management
  writing: FilePenLine,          // academic writing
  search: Search,                // scholarly search
  data: Database,                // data management
  ethics: ShieldCheck,           // ethics and security
  collaboration: Users,          // collaboration
  ai: BrainCircuit,              // AI research assistance
  monitoring: ClipboardCheck,    // study monitoring
  milestones: Calendar,          // milestones
  documents: FileText,           // research documents
  // interface
  check: Check, next: ArrowRight, open: ArrowUpRight, lock: Lock,
  success: CircleCheck, warning: TriangleAlert, error: CircleAlert, info: Info,
} as const satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

export type Tone = "cobalt" | "teal" | "navy" | "gold" | "violet" | "terracotta" | "ocean";
/** Tint behind an icon and the ink colour of the icon itself. Both pairs keep AA contrast for the icon on its tint. */
export const TONES: Record<Tone, { tile: string; ink: string; hover: string }> = {
  cobalt: { tile: "bg-primary/10", ink: "text-primary", hover: "hover:border-primary/60" },
  teal: { tile: "bg-teal/10", ink: "text-teal-ink", hover: "hover:border-teal/60" },
  navy: { tile: "bg-navy/10", ink: "text-navy", hover: "hover:border-navy/40" },
  gold: { tile: "bg-accent-amber/10", ink: "text-accent-amber", hover: "hover:border-accent-amber/50" },
  violet: { tile: "bg-accent-violet/10", ink: "text-accent-violet", hover: "hover:border-accent-violet/50" },
  terracotta: { tile: "bg-accent-terracotta/10", ink: "text-accent-terracotta", hover: "hover:border-accent-terracotta/50" },
  ocean: { tile: "bg-accent-ocean/10", ink: "text-accent-ocean", hover: "hover:border-accent-ocean/50" },
};

const SIZE = { sm: "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4", md: "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5", lg: "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6" } as const;

/** An icon in a tinted tile. Consistent size, stroke and alignment wherever an icon introduces a card or a section. */
export function IconWrapper({ icon: Icon, tone = "cobalt", size = "md", className = "" }: { icon: LucideIcon; tone?: Tone; size?: keyof typeof SIZE; className?: string }): ReactNode {
  return (
    <span aria-hidden="true" className={`inline-flex flex-none items-center justify-center rounded-control ${TONES[tone].tile} ${TONES[tone].ink} ${SIZE[size]} ${className}`}>
      <Icon strokeWidth={1.9} />
    </span>
  );
}
