import {
  Archive,
  ShieldAlert,
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
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Action } from "@/domain/auth/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The build phase that delivers this screen. Shown as unavailable until then. */
  availableFromPhase: number;
  /** Hidden from people whose role lacks this permission. */
  permission?: Action;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Where the app is in the build plan. Bump as each phase ships. */
export const CURRENT_PHASE = 11;

export const navigation: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Home", href: "/", icon: Home, availableFromPhase: 0 },
      {
        label: "Jobs",
        href: "/jobs",
        icon: Briefcase,
        availableFromPhase: 4,
        permission: "jobs.view",
      },
      {
        label: "Studies",
        href: "/studies",
        icon: ThermometerSnowflake,
        availableFromPhase: 5,
        permission: "data.import",
      },
      { label: "Reports", href: "/reports", icon: FileText, availableFromPhase: 8 },
      {
        label: "Reviews",
        href: "/reviews",
        icon: ClipboardCheck,
        availableFromPhase: 9,
        permission: "reports.check",
      },
    ],
  },
  {
    label: "Records",
    items: [
      {
        label: "Clients",
        href: "/clients",
        icon: Building2,
        availableFromPhase: 2,
        permission: "clients.view",
      },
      {
        label: "Instruments",
        href: "/instruments",
        icon: Gauge,
        availableFromPhase: 3,
        permission: "instruments.view",
      },
      {
        label: "Deviations",
        href: "/deviations",
        icon: ShieldAlert,
        availableFromPhase: 11,
        permission: "jobs.view",
      },
      {
        label: "Archive",
        href: "/archive",
        icon: Archive,
        availableFromPhase: 11,
        permission: "jobs.view",
      },
      {
        label: "Billing",
        href: "/billing",
        icon: ReceiptIndianRupee,
        availableFromPhase: 10,
        permission: "jobs.money",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        label: "Users",
        href: "/users",
        icon: Users,
        availableFromPhase: 1,
        permission: "users.view",
      },
      {
        label: "Audit trail",
        href: "/audit",
        icon: History,
        availableFromPhase: 1,
        permission: "audit.view",
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        availableFromPhase: 1,
        permission: "settings.view",
      },
    ],
  },
];

export function isNavItemAvailable(item: NavItem): boolean {
  return item.availableFromPhase <= CURRENT_PHASE;
}

/** Navigation for one person: items their role can't use are removed, empty groups dropped. */
export function navigationFor(allowed: readonly Action[]): NavGroup[] {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || allowed.includes(item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}
