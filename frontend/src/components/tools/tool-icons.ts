import {
  Activity, BookOpen, Bot, Boxes, Calculator, CalendarClock, ChartColumn, ChartLine, ChartScatter, CircleDot, ClipboardCheck, ClipboardList, Dices, FileQuestion,
  FileSearch, FileSpreadsheet, FileText, Filter, FlaskConical, FormInput, Gauge, GitCompare, Grid2x2, HeartPulse, Hourglass, Layers, Library, Lightbulb, Link2,
  ListChecks, MessageSquareText, Microscope, Network, PenLine, Percent, Quote, Repeat, Ruler, Scale, Search, ShieldCheck, Shuffle, Sigma, SlidersHorizontal,
  Sparkles, Split, Stethoscope, Table2, Target, Timer, TrendingUp, Users, UsersRound, Variable, type LucideIcon,
} from "lucide-react";
import type { IconKey } from "@/lib/tools/directory";

// One Lucide icon per key. Typed as a full Record, so adding a key to the directory without an icon is a compile error.
export const TOOL_ICONS: Record<IconKey, LucideIcon> = {
  calculator: Calculator, sigma: Sigma, percent: Percent, users: Users, "users-round": UsersRound, scale: Scale, activity: Activity, "trending-up": TrendingUp,
  stethoscope: Stethoscope, flask: FlaskConical, "clipboard-list": ClipboardList, "clipboard-check": ClipboardCheck, "file-text": FileText, "book-open": BookOpen,
  library: Library, search: Search, quote: Quote, "pen-line": PenLine, sparkles: Sparkles, table: Table2, grid: Grid2x2, "git-compare": GitCompare, link: Link2,
  target: Target, timer: Timer, "calendar-clock": CalendarClock, "shield-check": ShieldCheck, "list-checks": ListChecks, layers: Layers, network: Network, dices: Dices,
  gauge: Gauge, hourglass: Hourglass, repeat: Repeat, shuffle: Shuffle, boxes: Boxes, lightbulb: Lightbulb, filter: Filter, microscope: Microscope,
  "heart-pulse": HeartPulse, ruler: Ruler, sliders: SlidersHorizontal, variable: Variable, "chart-column": ChartColumn, "chart-line": ChartLine,
  "chart-scatter": ChartScatter, "file-question": FileQuestion, "message-text": MessageSquareText, "circle-dot": CircleDot, split: Split,
  "file-spreadsheet": FileSpreadsheet, "form-input": FormInput, "file-search": FileSearch, bot: Bot,
};
