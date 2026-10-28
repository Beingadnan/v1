import {
  Briefcase,
  Building2,
  ClipboardCheck,
  FileText,
  Gauge,
  History,
  Home,
  ReceiptIndianRupee,
  Settings,
  ThermometerSnowflake,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The build phase that delivers this screen. Shown as unavailable until then. */
  availableFromPhase: number;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Where the app is in the build plan. Bump as each phase ships. */
export const CURRENT_PHASE = 0;

export const navigation: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Home", href: "/", icon: Home, availableFromPhase: 0 },
      { label: "Jobs", href: "/jobs", icon: Briefcase, availableFromPhase: 4 },
      { label: "Studies", href: "/studies", icon: ThermometerSnowflake, availableFromPhase: 5 },
      { label: "Reports", href: "/reports", icon: FileText, availableFromPhase: 8 },
      { label: "Reviews", href: "/reviews", icon: ClipboardCheck, availableFromPhase: 9 },
    ],
  },
  {
    label: "Records",
    items: [
      { label: "Clients", href: "/clients", icon: Building2, availableFromPhase: 2 },
      { label: "Instruments", href: "/instruments", icon: Gauge, availableFromPhase: 3 },
      { label: "Billing", href: "/billing", icon: ReceiptIndianRupee, availableFromPhase: 10 },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Audit trail", href: "/audit", icon: History, availableFromPhase: 1 },
      { label: "Settings", href: "/settings", icon: Settings, availableFromPhase: 1 },
    ],
  },
];

export function isNavItemAvailable(item: NavItem): boolean {
  return item.availableFromPhase <= CURRENT_PHASE;
}
