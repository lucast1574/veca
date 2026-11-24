import {
  Gauge,
  HardHat,
  LayoutGrid,
  Kanban,
  Package,
  Users,
  Images,
  ShieldCheck,
  ReceiptText,
} from "lucide-react";
import {
  canViewAdministration,
  type Permission,
  type SessionUser,
} from "@veca/content";
export type WorkspaceView = Permission | "profile" | "administration";
export function canOpenWorkspace(view: WorkspaceView, user: SessionUser) {
  if (view === "profile") return true;
  if (view === "administration") return canViewAdministration(user);
  return (
    user.status === "active" &&
    user.emailVerified &&
    user.permissions.includes(view)
  );
}
export const WORKSPACE_ITEMS = [
  {
    id: "dashboard",
    label: "Resumen",
    description: "Tu día en VECA",
    Icon: Gauge,
    group: "Seguimiento",
  },
  {
    id: "leads",
    label: "Leads",
    description: "Consultas y obras",
    Icon: Kanban,
    group: "Seguimiento",
  },
  {
    id: "works",
    label: "Obras",
    description: "Preparación y ejecución",
    Icon: HardHat,
    group: "Seguimiento",
  },
  {
    id: "projects",
    label: "Proyectos",
    description: "El trabajo que publicamos",
    Icon: LayoutGrid,
    group: "Seguimiento",
  },
  {
    id: "gallery",
    label: "Galería",
    description: "Fotos privadas de las obras",
    Icon: Images,
    group: "Seguimiento",
  },
  {
    id: "inventory",
    label: "Inventario",
    description: "Materiales y movimientos",
    Icon: Package,
    group: "Empresa",
  },
  {
    id: "accounting",
    label: "Contabilidad",
    description: "Guías de remisión",
    Icon: ReceiptText,
    group: "Empresa",
  },
  {
    id: "users",
    label: "Equipo",
    description: "Personas y accesos",
    Icon: Users,
    group: "Empresa",
  },
  {
    id: "administration",
    label: "Administración",
    description: "Conexiones y actividad",
    Icon: ShieldCheck,
    group: "Empresa",
  },
] as const;
export const VIEW_LABELS: Record<WorkspaceView, string> = {
  ...Object.fromEntries(WORKSPACE_ITEMS.map((item) => [item.id, item.label])),
  profile: "Mi perfil",
} as Record<WorkspaceView, string>;
export function currentView(): WorkspaceView {
  const section = location.hash.slice(1).split("/")[0];
  return section === "profile" ||
    WORKSPACE_ITEMS.some((item) => item.id === section)
    ? (section as WorkspaceView)
    : "dashboard";
}
