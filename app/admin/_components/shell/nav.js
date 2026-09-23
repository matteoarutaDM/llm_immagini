import { BuildingLibraryIcon, ChartBarSquareIcon, ClipboardDocumentListIcon, DocumentMagnifyingGlassIcon, UsersIcon } from "@heroicons/react/24/outline";

/** Sidebar entries; each is shown only when the operator holds `permission`. */
export const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: ChartBarSquareIcon, permission: "dashboard:view", exact: true },
  { href: "/admin/analyses", label: "Analisi", icon: DocumentMagnifyingGlassIcon, permission: "analyses:view" },
  { href: "/admin/users", label: "Utenti", icon: UsersIcon, permission: "users:view" },
  { href: "/admin/documents", label: "Documenti", icon: BuildingLibraryIcon, permission: "documents:view" },
  { href: "/admin/audit", label: "Registro attività", icon: ClipboardDocumentListIcon, permission: "audit:view" },
];

export function isActive(item, pathname) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
