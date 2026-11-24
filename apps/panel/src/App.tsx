import { WorkspaceShell } from "./components/workspace/WorkspaceShell";
import {
  canOpenWorkspace,
  currentView,
  type WorkspaceView as View,
} from "./components/workspace/navigation";
import { AuthScreen } from "./features/access/AuthScreen";
import { type AuthSession } from "@veca/content";

import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  FileText,
  Globe,
  Images,
  LayoutGrid,
  Plus,
  Search,
  Star,
} from "lucide-react";
import {
  CATEGORIES,
  type LandingProjectSelection,
  type Project,
} from "@veca/content";
import { api, ApiError, post, setCsrf } from "./lib/api";
import { Button, Notice, Status } from "./components/ui";
import { LandingProjects } from "./features/editor/LandingProjects";
import { WorkPhotoPicker } from "./features/editor/WorkPhotoPicker";
import { CompletedWorks } from "./features/editor/CompletedWorks";
import {
  ProjectCreateDialog,
  type ProjectStart,
} from "./features/editor/ProjectCreateDialog";
import { useProjectRoute } from "./features/editor/useProjectRoute";
import { canLeaveWorkspace } from "./lib/unsaved";

const UserProfile = lazy(() =>
  import("./features/profile/UserProfile").then((module) => ({
    default: module.UserProfile,
  })),
);
const PendingAccess = lazy(() =>
  import("./features/access/PendingAccess").then((module) => ({
    default: module.PendingAccess,
  })),
);
const Team = lazy(() =>
  import("./features/access/Team").then((module) => ({ default: module.Team })),
);
const Dashboard = lazy(() =>
  import("./features/dashboard/Dashboard").then((module) => ({
    default: module.Dashboard,
  })),
);
const Administration = lazy(() =>
  import("./features/administration/Administration").then((module) => ({
    default: module.Administration,
  })),
);
const PrivateGallery = lazy(() =>
  import("./features/gallery/PrivateGallery").then((module) => ({
    default: module.PrivateGallery,
  })),
);
const AccountingWorkspace = lazy(() =>
  import("./features/accounting/AccountingWorkspace").then((module) => ({
    default: module.AccountingWorkspace,
  })),
);
const WorksWorkspace = lazy(() =>
  import("./features/works/WorksWorkspace").then((module) => ({
    default: module.WorksWorkspace,
  })),
);
const Operations = lazy(() =>
  import("./features/operations/Operations").then((module) => ({
    default: module.Operations,
  })),
);
const ProjectEditor = lazy(() =>
  import("./features/editor/ProjectEditor").then((module) => ({
    default: module.ProjectEditor,
  })),
);

class SectionBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <main className="ops-page">
        <h1>No pudimos abrir la sección</h1>
        <p>Actualiza el panel para volver a cargarla.</p>
        <Button type="button" onClick={() => window.location.reload()}>
          Actualizar panel
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}

type Session = AuthSession;
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const workspaceAccount = useRef<string | null>(null);
  const [view, setView] = useState<View>(currentView);
  const appliedHash = useRef(location.hash);
  const approvedHash = useRef<string | null>(null);
  const historyIndex = useRef<number>(history.state?.vecaWorkspaceIndex ?? 0);
  useEffect(() => {
    history.replaceState(
      { ...history.state, vecaWorkspaceIndex: historyIndex.current },
      "",
    );
    const change = (event: HashChangeEvent) => {
      const next = location.hash;
      if (next === appliedHash.current) return;
      const approved = next === approvedHash.current;
      approvedHash.current = null;
      if (!approved && !canLeaveWorkspace()) {
        event.stopImmediatePropagation();
        const destinationIndex =
          history.state?.vecaWorkspaceIndex ?? historyIndex.current + 1;
        const distance = historyIndex.current - destinationIndex;
        if (distance) history.go(distance);
        else
          history.replaceState(
            history.state,
            "",
            appliedHash.current || location.pathname + location.search,
          );
        return;
      }
      const previousView = appliedHash.current.slice(1).split("/")[0];
      appliedHash.current = next;
      historyIndex.current =
        history.state?.vecaWorkspaceIndex ?? historyIndex.current + 1;
      history.replaceState(
        { ...history.state, vecaWorkspaceIndex: historyIndex.current },
        "",
      );
      const nextView = currentView();
      setCreatingProject(false);
      if (previousView === "projects" && nextView !== "projects") {
        setEditing(undefined);
        setProjectSeed(undefined);
        setManagingLanding(false);
      }
      setView(nextView);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", change, true);
    return () => window.removeEventListener("hashchange", change, true);
  }, []);
  function navigate(next: View) {
    if (location.hash === "#" + next && editing === undefined) return true;
    if (!canLeaveWorkspace()) return false;
    setEditing(undefined);
    setCreatingProject(false);
    setProjectSeed(undefined);
    if (location.hash !== "#" + next) {
      approvedHash.current = "#" + next;
      location.hash = next;
    }
    return true;
  }

  const [loading, setLoading] = useState(true);
  const [connectionLost, setConnectionLost] = useState(false);
  const [expired, setExpired] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [landingSelection, setLandingSelection] =
    useState<LandingProjectSelection>();
  const [landingError, setLandingError] = useState("");
  const [managingLanding, setManagingLanding] = useState(false);
  const [error, setError] = useState("");
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [editing, setEditing] = useState<Project | null | undefined>(undefined);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectSeed, setProjectSeed] = useState<ProjectStart>();
  const [sourceWork, setSourceWork] = useState<string>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const login = useCallback((s: Session) => {
    if (workspaceAccount.current !== s.user.id) {
      workspaceAccount.current = s.user.id;
      setEditing(undefined);
      setCreatingProject(false);
      setProjectSeed(undefined);
      setProjects([]);
      setLandingSelection(undefined);
      setLandingError("");
      setManagingLanding(false);
      setError("");
      setStorageConfigured(true);
      setSearch("");
      setFilter("all");
    }
    if (appliedHash.current !== location.hash) {
      appliedHash.current = location.hash;
      setView(currentView());
    }
    if (
      (!location.hash || location.hash === "#dashboard") &&
      !canOpenWorkspace("dashboard", s.user) &&
      canOpenWorkspace("works", s.user)
    ) {
      location.hash = "works";
      appliedHash.current = "#works";
      setView("works");
    }
    setCsrf(s.csrf);
    setSession(s);
    setConnectionLost(false);
    setExpired(false);
  }, []);
  const refreshLanding = useCallback(async (signal?: AbortSignal) => {
    const account = workspaceAccount.current;
    const timeout = AbortSignal.timeout(8000);
    setLandingError("");
    try {
      const selection = await api<LandingProjectSelection>(
        "/admin/projects/landing",
        { signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
      );
      if (signal?.aborted || workspaceAccount.current !== account) return;
      if (timeout.aborted) throw timeout.reason;
      setLandingSelection((current) =>
        current && current.revision > selection.revision ? current : selection,
      );
    } catch {
      if (!signal?.aborted && workspaceAccount.current === account)
        setLandingError("No pudimos cargar los proyectos de la portada.");
    }
  }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const account = workspaceAccount.current;
      void refreshLanding(signal);
      try {
        const rows = await api<Project[]>("/admin/projects", { signal });
        if (signal?.aborted || workspaceAccount.current !== account) return;
        setProjects(rows);
        setError("");
      } catch (error) {
        if (!signal?.aborted && workspaceAccount.current === account)
          setError((error as Error).message);
      }
    },
    [refreshLanding],
  );
  useEffect(() => {
    api<Session>("/auth/me")
      .then(login)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [login]);
  const canEditProjects =
    !!session && canOpenWorkspace("projects", session.user);
  const userId = session?.user.id;
  useEffect(() => {
    if (view !== "projects" || !canEditProjects || expired) return;
    const controller = new AbortController();
    const { signal } = controller;
    void refresh(signal);
    void api<{ storageConfigured: boolean }>("/admin/system", { signal })
      .then((result) => {
        if (!signal.aborted && workspaceAccount.current === userId)
          setStorageConfigured(result.storageConfigured);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [view, canEditProjects, userId, expired, refresh]);
  const userStatus = session?.user.status;
  useProjectRoute(
    session?.user.status === "active" &&
      session.user.permissions.includes("projects")
      ? session.user.id
      : undefined,
    setEditing,
    setSourceWork,
    setError,
  );
  const sessionCheck = useRef<AbortController | null>(null);
  const checkSession = useCallback(async () => {
    if (sessionCheck.current) return;
    const controller = new AbortController();
    sessionCheck.current = controller;
    try {
      const current = await api<Session>("/auth/me", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10_000),
        ]),
      });
      if (controller.signal.aborted) return;
      if (current.user.id !== workspaceAccount.current) {
        setExpired(true);
        setConnectionLost(false);
        return;
      }
      login(current);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        setExpired(true);
        setConnectionLost(false);
      } else {
        setConnectionLost(true);
      }
    } finally {
      if (sessionCheck.current === controller) sessionCheck.current = null;
    }
  }, [login]);
  useEffect(() => {
    if (!userId || userStatus !== "active" || expired) return;
    const check = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    const offline = () => setConnectionLost(true);
    const timer = window.setInterval(check, 60000);
    window.addEventListener("online", check);
    window.addEventListener("offline", offline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", offline);
      sessionCheck.current?.abort();
      sessionCheck.current = null;
    };
  }, [userId, userStatus, expired, checkSession]);
  useEffect(() => {
    document.body.classList.toggle("veca-reauthenticating", expired);
    return () => document.body.classList.remove("veca-reauthenticating");
  }, [expired]);
  const landingOrder = useMemo(() => {
    if (!landingSelection) return new Map<string, number>();
    const visible = [
      ...landingSelection.items,
      ...Object.values(landingSelection.placements ?? {}).flatMap(
        ({ project }) => project ?? [],
      ),
    ].filter(({ published }) => published);
    const ids = [...new Set(visible.map(({ id }) => id))];
    return new Map(ids.map((id, index) => [id, index]));
  }, [landingSelection]);
  const filtered = useMemo(() => {
    const matches = projects.filter(
      (p) =>
        (filter === "all" ||
          (filter === "landing" && landingOrder.has(p.id)) ||
          p.status === filter) &&
        `${p.title} ${p.location} ${p.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
    return filter === "landing"
      ? matches.sort(
          (a, b) =>
            (landingOrder.get(a.id) ?? 0) - (landingOrder.get(b.id) ?? 0),
        )
      : matches;
  }, [projects, filter, search, landingOrder]);
  if (loading)
    return <div className="loading-screen">Abriendo el estudio de VECA…</div>;
  if (!session) return <AuthScreen onLogin={login} />;
  const active = session.user.status === "active" && session.user.emailVerified;
  const can = (view: View) => canOpenWorkspace(view, session.user);
  async function logout() {
    await post("/auth/logout", {});
    sessionCheck.current?.abort();
    sessionCheck.current = null;
    setCsrf("");
    workspaceAccount.current = null;
    setSession(null);
    setEditing(undefined);
    setCreatingProject(false);
    setProjectSeed(undefined);
    setManagingLanding(false);
  }
  return (
    <>
      {expired && <AuthScreen onLogin={login} sessionExpired />}
      <div hidden={expired} inert={expired}>
        <div id="workspace-surface">
          <WorkspaceShell
            key={session.user.id}
            user={session.user}
            sessionKey={session.csrf}
            view={view}
            projectCount={projects.length}
            onNavigate={navigate}
            detail={
              view === "projects" && editing !== undefined
                ? editing
                  ? "Editar proyecto"
                  : "Nuevo proyecto"
                : undefined
            }
          >
            {connectionLost && (
              <Notice>
                No pudimos comprobar la conexión. Tu trabajo sigue abierto.{" "}
                <button type="button" onClick={() => void checkSession()}>
                  Comprobar conexión
                </button>
              </Notice>
            )}
            <SectionBoundary key={view}>
              <Suspense
                fallback={
                  <p className="ops-page" role="status">
                    Cargando sección…
                  </p>
                }
              >
                {!storageConfigured && view === "projects" && (
                  <Notice>
                    El almacenamiento de fotografías está pendiente de
                    activación en Nexode. Puedes preparar y guardar los textos;
                    la publicación se habilita con una portada.
                  </Notice>
                )}
                {view === "profile" ? (
                  <UserProfile
                    user={session.user}
                    onLogout={logout}
                    onNavigate={navigate}
                    onUpdate={(user) =>
                      setSession((current) =>
                        current ? { ...current, user } : null,
                      )
                    }
                  />
                ) : !active ? (
                  <PendingAccess
                    session={session}
                    onUpdate={login}
                    onProfile={() => navigate("profile")}
                  />
                ) : !can(view) ? (
                  <main className="ops-page">
                    <h1>Este espacio no está disponible para tu rol.</h1>
                    <p>Solicita al administrador que revise tus permisos.</p>
                    <Button onClick={() => navigate("profile")}>
                      Revisar mi perfil
                    </Button>
                  </main>
                ) : view === "dashboard" ? (
                  <Dashboard user={session.user} />
                ) : view === "users" ? (
                  <Team currentId={session.user.id} />
                ) : view === "administration" ? (
                  <Administration />
                ) : view === "gallery" ? (
                  <PrivateGallery
                    canOpenLead={can("leads")}
                    canOpenProjects={can("projects")}
                  />
                ) : view === "works" ? (
                  <WorksWorkspace
                    user={session.user}
                    canEdit={session.user.permissions.includes("works_manage")}
                    inventoryAccess={can("inventory")}
                    dispatchAccess={session.user.permissions.includes(
                      "dispatches",
                    )}
                    accountingAccess={can("accounting")}
                  />
                ) : view === "accounting" ? (
                  <AccountingWorkspace
                    user={session.user}
                    inventoryAccess={can("inventory")}
                  />
                ) : view === "leads" || view === "inventory" ? (
                  <Operations
                    user={session.user}
                    worksAccess={can("works")}
                    view={view}
                    inventoryAccess={can("inventory")}
                    dispatchAccess={session.user.permissions.includes(
                      "dispatches",
                    )}
                    accountingAccess={can("accounting")}
                  />
                ) : editing !== undefined ? (
                  <ProjectEditor
                    key={editing?.id || "new"}
                    initial={editing}
                    seed={projectSeed}
                    onBack={() => {
                      setEditing(undefined);
                      setCreatingProject(false);
                      setProjectSeed(undefined);
                      location.hash = "projects";
                      void refresh();
                    }}
                    onSaved={(project) => {
                      setProjects((old) => [
                        project,
                        ...old.filter((p) => p.id !== project.id),
                      ]);
                      if (project.status === "published") void refreshLanding();
                    }}
                  />
                ) : (
                  <main className="dashboard">
                    <div className="dashboard-heading">
                      <div>
                        <p className="overline">
                          EL TRABAJO HABLA POR NOSOTROS
                        </p>
                        <h1>
                          Proyectos con perspectiva<span>.</span>
                        </h1>
                        <p>
                          Publica historias reales. Cuida cada imagen. Comparte
                          lo que hace diferente a VECA.
                        </p>
                      </div>
                      <div className="project-heading-actions">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (landingError && !landingSelection)
                              void refreshLanding();
                            setManagingLanding(true);
                          }}
                        >
                          <Star size={17} />
                          Gestionar portada
                        </Button>
                        <Button onClick={() => setCreatingProject(true)}>
                          <Plus size={18} />
                          Nuevo proyecto
                        </Button>
                      </div>
                    </div>
                    <div className="stats-grid">
                      {[
                        {
                          label: "Total de proyectos",
                          value: projects.length,
                          Icon: LayoutGrid,
                        },
                        {
                          label: "En la web",
                          value: projects.filter(
                            (p) => p.status === "published",
                          ).length,
                          Icon: Globe,
                        },
                        {
                          label: "En preparación",
                          value: projects.filter((p) => p.status === "draft")
                            .length,
                          Icon: FileText,
                        },
                        {
                          label: "En portada",
                          value: landingSelection ? landingOrder.size : null,
                          Icon: Star,
                        },
                      ].map(({ label, value, Icon }) => (
                        <div className="stat-card" key={label}>
                          <div>
                            <span>{label}</span>
                            <strong>
                              {value === null
                                ? "—"
                                : String(value).padStart(2, "0")}
                            </strong>
                          </div>
                          <Icon size={23} />
                        </div>
                      ))}
                    </div>
                    <div className="project-tools">
                      <div className="project-tabs">
                        {[
                          ["all", "Todos"],
                          ["published", "Publicados"],
                          ["draft", "Borradores"],
                          ["landing", "En portada"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            aria-pressed={filter === value}
                            onClick={() => setFilter(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label className="search-input">
                        <Search size={17} />
                        <input
                          aria-label="Buscar proyectos"
                          placeholder="Buscar un proyecto…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                    </div>
                    <CompletedWorks />
                    {error && (
                      <Notice error>
                        {error}
                        <button onClick={() => void refresh()}>
                          Reintentar
                        </button>
                      </Notice>
                    )}
                    {!projects.length ? (
                      <section className="projects-empty">
                        <div className="empty-art" aria-hidden="true">
                          <Images size={42} />
                        </div>
                        <p className="overline">
                          UNA NUEVA FORMA DE MOSTRAR LO QUE HACEMOS
                        </p>
                        <h2>La primera historia empieza aquí.</h2>
                        <p>
                          Sube las fotos de un trabajo, cuenta cómo transformó
                          el espacio y revísalo antes de compartirlo con el
                          mundo.
                        </p>
                        <Button onClick={() => setCreatingProject(true)}>
                          <Plus size={17} />
                          Crear mi primer proyecto
                        </Button>
                      </section>
                    ) : !filtered.length ? (
                      <div className="empty-search">
                        <Search size={28} />
                        <h2>No encontramos proyectos</h2>
                        <p>Prueba con otro título o cambia el filtro.</p>
                      </div>
                    ) : (
                      <div className="admin-project-grid">
                        {filtered.map((project) => {
                          const cover = project.images.find(
                            (i) => i.id === project.coverId,
                          );
                          return (
                            <button
                              className="admin-project"
                              key={project.id}
                              onClick={() => setEditing(project)}
                            >
                              <div className="admin-project-image">
                                {cover ? (
                                  <img
                                    src={cover.url}
                                    alt={cover.alt}
                                    loading="lazy"
                                    decoding="async"
                                    style={{
                                      objectPosition: `${cover.positionX}% ${cover.positionY}%`,
                                    }}
                                  />
                                ) : (
                                  <Images size={35} />
                                )}
                                <Status
                                  published={project.status === "published"}
                                  changed={project.hasUnpublishedChanges}
                                />
                                {landingOrder.has(project.id) && (
                                  <span
                                    className="featured-star"
                                    aria-label="En la portada"
                                    role="img"
                                  >
                                    <Star size={16} aria-hidden="true" />
                                  </span>
                                )}
                              </div>
                              <div className="admin-project-copy">
                                <p>
                                  {
                                    CATEGORIES.find(
                                      (c) => c.id === project.category,
                                    )?.name
                                  }
                                </p>
                                <h2>{project.title}</h2>
                                <div>
                                  <span>
                                    {new Date(
                                      project.updatedAt,
                                    ).toLocaleDateString("es-PE", {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </span>
                                  <span>
                                    Editar proyecto
                                    <ArrowUpRight size={15} />
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {managingLanding && (
                      <LandingProjects
                        projects={projects}
                        selection={landingSelection}
                        loadError={landingError}
                        onReload={() => void refreshLanding()}
                        onClose={() => setManagingLanding(false)}
                        onSelection={setLandingSelection}
                      />
                    )}
                    <footer className="studio-footer">
                      <span>VIDRIOS VECA / ESTUDIO EDITORIAL</span>
                      <span>Diseñado para dar espacio a tus proyectos.</span>
                    </footer>
                  </main>
                )}
              </Suspense>
            </SectionBoundary>
          </WorkspaceShell>
          {creatingProject && active && can("projects") && (
            <ProjectCreateDialog
              close={() => setCreatingProject(false)}
              next={(seed) => {
                setProjectSeed(seed);
                setCreatingProject(false);
                setEditing(null);
              }}
            />
          )}
          {sourceWork && session.user.permissions.includes("projects") && (
            <WorkPhotoPicker
              key={sourceWork}
              id={sourceWork}
              onClose={() => {
                setSourceWork(undefined);
                location.hash = "projects";
              }}
              onCreated={(project) => {
                setSourceWork(undefined);
                setEditing(project);
                setProjects((old) => [
                  project,
                  ...old.filter((p) => p.id !== project.id),
                ]);
                location.hash = `projects/${project.id}`;
              }}
            />
          )}
        </div>
        <div id="workspace-overlays" />
      </div>
    </>
  );
}
