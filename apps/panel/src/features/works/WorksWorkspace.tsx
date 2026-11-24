import { useCallback, useEffect, useState } from "react";
import {
  HardHat,
  Search,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type { Lead, SessionUser } from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { api } from "../../lib/api";
import { Button, Notice } from "../../components/ui";
import { LeadDetail } from "../operations/LeadDetail";
import { useLiveRefresh } from "../operations/shared";
import "../operations/operations.css";
import "./works.css";

const stages = [
  { value: "", label: "Todas las obras" },
  { value: "coordination", label: "Por preparar" },
  { value: "execution", label: "En ejecución" },
  { value: "completed", label: "Realizadas" },
];
type WorkPage = { items: Lead[]; total: number; page: number; pages: number };

export function WorksWorkspace({
  canEdit,
  inventoryAccess,
  dispatchAccess,
  accountingAccess,
  user,
}: {
  user: SessionUser;
  canEdit: boolean;
  inventoryAccess: boolean;
  dispatchAccess: boolean;
  accountingAccess: boolean;
}) {
  const [id, setId] = useState(() => location.hash.split("/")[1] || "");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<WorkPage>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const update = () => setId(location.hash.split("/")[1] || "");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useLiveRefresh(refresh, false, !id, "/admin/works/events");
  useEffect(() => {
    if (id) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams({
          search,
          stage,
          page: String(page),
          mine: mine ? "true" : "",
        });
        api<WorkPage>("/admin/works?" + params, { signal: controller.signal })
          .then((value) => {
            if (!controller.signal.aborted) setData(value);
          })
          .catch((issue: Error) => {
            if (!controller.signal.aborted) setError(issue.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, search, stage, page, revision, mine]);

  if (id)
    return (
      <>
        <LeadDetail
          key={id}
          id={id}
          workView
          user={user}
          readOnly={!canEdit}
          inventoryAccess={inventoryAccess}
          dispatchAccess={dispatchAccess}
          back={() => {
            location.hash = "works";
          }}
        />
      </>
    );

  return (
    <main className="ops-page works-page">
      <header className="ops-heading">
        <div>
          <h1>
            {user.permissions.some(
              (p) => p === "works_all" || p === "works_manage",
            )
              ? "Obras"
              : "Mis obras"}
          </h1>
          <span>Preparación, ejecución y seguimiento del equipo</span>
        </div>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Actualizar
        </Button>
      </header>
      <div className="ops-toolbar works-tools">
        <label className="search-input">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Buscar obras"
            placeholder="Cliente, dirección o responsable"
            value={search}
            maxLength={120}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select
          label="Estado de la obra"
          value={stage}
          options={stages}
          onChange={(value) => {
            setStage(value);
            setPage(1);
          }}
        />
      </div>
      {user.permissions.some(
        (permission) =>
          permission === "works_all" || permission === "works_manage",
      ) && (
        <div
          className="gallery-usage-tabs work-scope"
          role="group"
          aria-label="Alcance de obras"
        >
          <button
            type="button"
            aria-pressed={!mine}
            onClick={() => {
              setMine(false);
              setPage(1);
            }}
          >
            Todas las obras
          </button>
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => {
              setMine(true);
              setPage(1);
            }}
          >
            Mis obras
          </button>
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
      <p className="works-count" role="status">
        {loading
          ? "Buscando obras…"
          : data
            ? `${data.total} ${data.total === 1 ? "obra" : "obras"}`
            : ""}
      </p>
      {!loading && !error && !data?.items.length && (
        <section className="ops-card works-empty">
          <HardHat size={30} aria-hidden="true" />
          <h2>
            {search || stage ? "No encontramos obras" : "Aún no hay obras"}
          </h2>
          <p>
            {search || stage
              ? "Prueba otra búsqueda o cambia el estado."
              : user.permissions.some(
                    (p) => p === "works_all" || p === "works_manage",
                  )
                ? "Las entregas enviadas desde Leads aparecen aquí para preparar la obra."
                : "Aquí aparecerán las obras que te asignen cuando el coordinador acepte la entrega."}
          </p>
        </section>
      )}
      <div className="works-grid" aria-busy={loading}>
        {data?.items.map((work) => (
          <a
            className="ops-card work-card"
            href={`#works/${work.id}`}
            key={work.id}
          >
            <span className="lead-detail-stage">
              {stages.find((item) => item.value === work.stage)?.label}
            </span>
            {work.workHandoff?.status === "submitted" && (
              <p className="hint">Entrega por revisar</p>
            )}
            {work.workHandoff?.status === "returned" && (
              <p className="hint">Devuelta a Comercial</p>
            )}
            {work.stageRequest?.status === "pending" && (
              <p className="hint">Avance solicitado · Por aprobar</p>
            )}
            <h2>{work.workName || work.name}</h2>
            <p>{work.address || work.district || "Dirección por completar"}</p>
            <p>{work.workPlan || work.idea || "Alcance por completar"}</p>
            <footer>
              <span>{work.assignedTo || "Responsable por asignar"}</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </footer>
          </a>
        ))}
      </div>
      {data && data.pages > 1 && (
        <nav className="gallery-pagination" aria-label="Páginas de obras">
          <Button
            variant="ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ArrowLeft size={16} /> Anterior
          </Button>
          <span>
            {page} de {data.pages}
          </span>
          <Button
            variant="ghost"
            disabled={page >= data.pages || loading}
            onClick={() => setPage(page + 1)}
          >
            Siguiente <ArrowRight size={16} />
          </Button>
        </nav>
      )}
    </main>
  );
}
