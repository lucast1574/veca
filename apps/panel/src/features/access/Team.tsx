import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import {
  Users,
  ShieldCheck,
  Search,
  Check,
  UserRoundCheck,
  Pause,
} from "lucide-react";
import {
  type RoleDefinition,
  type UserSummary,
  type Role,
} from "@veca/content";
import { UserAvatar } from "../../components/workspace/UserAvatar";
import { Select } from "@veca/ui/src/Select";
import { api } from "../../lib/api";
import { Button, Notice } from "../../components/ui";
import { Modal } from "../../components/Modal";
type List = {
  roles: RoleDefinition[];
  items: UserSummary[];
  pending: number;
  total: number;
  page: number;
};
const statuses: Record<string, string> = {
  active: "Acceso activo",
  pending: "Pendiente",
  rejected: "No aprobado",
  suspended: "Suspendido",
};

const roleDirections: Partial<Record<string, number>> = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1,
};

function moveRoleFocus(event: KeyboardEvent<HTMLFieldSetElement>) {
  const direction = roleDirections[event.key];
  if (!direction) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"),
  ];
  const index = buttons.findIndex((button) => button === event.target);
  if (index < 0) return;
  event.preventDefault();
  buttons[(index + direction + buttons.length) % buttons.length].focus();
}

export function Team({ currentId }: { currentId: string }) {
  const [data, setData] = useState<List | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<UserSummary | null>(null),
    [roles, setRoles] = useState<Role[]>([]),
    [status, setStatus] = useState("active"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const close = useCallback(() => {
    setSelected(null);
    setError("");
  }, []);
  const refresh = useCallback(() => {
    void api<List>(`/admin/users?search=${encodeURIComponent(search)}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [search]);
  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);
  async function more() {
    if (!data) return;
    try {
      const next = await api<List>(
        `/admin/users?search=${encodeURIComponent(search)}&page=${data.page + 1}`,
      );
      setData({ ...next, items: [...data.items, ...next.items] });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function edit(user: UserSummary) {
    setSelected(user);
    const assigned = user.roles ?? (user.role ? [user.role] : []);
    setRoles(
      assigned.filter((id) => data?.roles.some((role) => role.id === id)),
    );
    setStatus(
      user.status === "active"
        ? "active"
        : user.status === "pending"
          ? "active"
          : user.status,
    );
    setError("");
  }
  function toggleRole(id: Role) {
    setRoles((current) =>
      current.includes(id)
        ? current.filter((role) => role !== id)
        : [...current, id],
    );
  }
  async function save(nextStatus = status) {
    if (!selected || busy || (nextStatus === "active" && !roles.length)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/users/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...(selected.status === "pending" && nextStatus === "rejected"
            ? {}
            : { roles }),
          status: nextStatus,
          revision: selected.revision,
        }),
      });
      setSelected(null);
      setNotice(
        "Acceso actualizado. El cambio de permisos se aplica también a las sesiones abiertas.",
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = (data?.items || []).filter(
    (u) => filter === "all" || u.status === filter,
  );
  const permissions = [
    ...new Set(
      data?.roles
        .filter((role) => roles.includes(role.id))
        .flatMap((role) => role.permissions),
    ),
  ];
  return (
    <main className="ops-page team-page">
      <div className="ops-heading">
        <div>
          <p>Personas y permisos</p>
          <h1>
            El equipo detrás
            <br />
            de cada obra.
          </h1>
          <span>
            Aprueba solicitudes y asigna el espacio que necesita cada persona.
          </span>
        </div>
        <div className="team-counter">
          <UserRoundCheck size={22} />
          <strong>{data?.pending || 0}</strong>
          <span>solicitudes verificadas</span>
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {error && !selected && <Notice error>{error}</Notice>}
      <div className="ops-toolbar">
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="Buscar personas"
            placeholder="Nombre o correo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Select
          label="Filtrar estado de acceso"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Todo el equipo" },
            { value: "pending", label: "Pendientes de aprobación" },
            { value: "active", label: "Accesos activos" },
            { value: "suspended", label: "Suspendidos" },
            { value: "rejected", label: "No aprobados" },
          ]}
        />
      </div>
      <div className="team-grid">
        {filtered.map((user) => (
          <article className="team-card" key={user.id}>
            <div className="team-card-top">
              <UserAvatar name={user.name} src={user.avatarUrl} />
              <span className={`team-state state-${user.status}`}>
                {statuses[user.status]}
              </span>
            </div>
            <h2>{user.name}</h2>
            <p>{user.email || user.username}</p>
            <span className="team-role">
              <ShieldCheck size={14} />
              {user.roleName || "Sin rol asignado"}
            </span>
            <div className="team-card-meta">
              <span>
                {user.emailVerified
                  ? "Correo verificado"
                  : "Debe verificar su correo"}
              </span>
              <span>
                {user.provider === "google" ? "Google" : "Correo y contraseña"}
              </span>
            </div>
            <Button
              variant={user.status === "pending" ? "primary" : "ghost"}
              disabled={user.id === currentId || !user.emailVerified}
              onClick={() => edit(user)}
            >
              {user.id === currentId
                ? "Tu cuenta"
                : user.status === "pending"
                  ? "Revisar solicitud"
                  : "Editar acceso"}
            </Button>
          </article>
        ))}
      </div>
      {data && !filtered.length && (
        <div className="workspace-empty">
          <Users size={30} />
          <h2>Todo al día por aquí.</h2>
          <p>No hay personas que coincidan con este filtro.</p>
        </div>
      )}
      {data && data.items.length < data.total && (
        <Button variant="ghost" onClick={() => void more()}>
          Cargar más personas
        </Button>
      )}
      {selected && (
        <Modal
          title={
            selected.status === "pending"
              ? "Revisar solicitud de acceso"
              : "Editar acceso"
          }
          description={`${selected.name} · ${selected.email || selected.username}`}
          onClose={close}
          busy={busy}
          footer={
            <footer className="ve-modal-actions">
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancelar
              </Button>
              {selected.status === "pending" && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void save("rejected")}
                >
                  No aprobar
                </Button>
              )}
              <Button
                onClick={() => void save()}
                disabled={busy || (status === "active" && !roles.length)}
              >
                {status === "active" ? (
                  <ShieldCheck size={16} />
                ) : (
                  <Pause size={16} />
                )}{" "}
                {busy
                  ? "Guardando…"
                  : status === "active"
                    ? "Confirmar acceso"
                    : "Guardar estado"}
              </Button>
            </footer>
          }
        >
          {error && <Notice error>{error}</Notice>}
          <fieldset className="role-picker" onKeyDown={moveRoleFocus}>
            <legend>Selecciona uno o más roles</legend>
            {data?.roles.map((r) => {
              const isSelected = roles.includes(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  aria-pressed={isSelected}
                  onClick={() => toggleRole(r.id)}
                  disabled={busy}
                  className={isSelected ? "selected" : ""}
                >
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.description}</small>
                  </span>
                  {isSelected ? (
                    <Check size={18} aria-hidden="true" />
                  ) : (
                    <span className="role-empty-mark" />
                  )}
                </button>
              );
            })}
          </fieldset>
          {permissions.length > 0 && (
            <p className="role-sections">
              Permisos asignados:{" "}
              {permissions
                .map(
                  (p) =>
                    ({
                      dashboard: "Resumen",
                      projects: "Proyectos",
                      leads: "Leads",
                      works: "Obras asignadas",
                      works_all: "Consultar todas las obras",
                      works_manage: "Coordinar y asignar obras",
                      works_report: "Registrar avances",
                      gallery: "Galería",
                      inventory: "Consultar inventario",
                      inventory_request: "Solicitar materiales y compras",
                      inventory_reserve: "Reservar materiales",
                      inventory_receive: "Recibir compras y devoluciones",
                      inventory_dispatch: "Confirmar salidas",
                      inventory_adjust: "Ajustar existencias",
                      inventory_catalog: "Administrar catálogo",
                      inventory_equipment: "Gestionar equipos",
                      purchases_manage: "Autorizar compras",
                      dispatches: "Despachos",
                      accounting: "Consultar Contabilidad",
                      accounting_write: "Gestionar documentos, gastos y cobros",
                      accounting_issue:
                        "Emitir y verificar documentos fiscales",
                      accounting_labor: "Acceder a planilla y honorarios",
                      users: "Equipo",
                    })[p],
                )
                .join(" · ")}
            </p>
          )}
          {selected.status !== "pending" && (
            <div className="role-status">
              <Select
                label="Estado del acceso"
                value={status}
                onChange={setStatus}
                options={[
                  {
                    value: "active",
                    label: "Aprobar acceso",
                    description: "Puede entrar con los roles seleccionados",
                  },
                  {
                    value: "suspended",
                    label: "Suspender acceso",
                    description:
                      "Conserva la cuenta, sin acceso a la operación",
                  },
                  {
                    value: "rejected",
                    label: "No aprobar",
                    description: "La solicitud no recibirá acceso",
                  },
                ]}
              />
            </div>
          )}
        </Modal>
      )}
    </main>
  );
}
