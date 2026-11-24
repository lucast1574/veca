import { useCallback, useEffect, useState } from "react";
import {
  LEAD_STAGES,
  LEAD_SEGMENTS,
  REQUEST_TYPES,
  LEAD_SOURCE_LABELS,
  isDemoLead,
  type Lead,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import {
  ArrowRight,
  GripVertical,
  List,
  Kanban,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "../../lib/api";
import { Button, Notice } from "../../components/ui";
import { CreateLeadModal } from "./CreateLeadModal";
import { stageName, useLiveRefresh } from "./shared";

type LeadPage = { items: Lead[]; total: number };
export type LeadBoardFilters = {
  search: string;
  segment: string;
  stage: string;
};
export const emptyLeadFilters: LeadBoardFilters = {
  search: "",
  segment: "",
  stage: "",
};
const layoutOptions = [
  { value: "list", label: "Lista" },
  { value: "board", label: "Tablero" },
];

export function LeadBoard({
  filters,
  onFilter,
  page,
  active,
  setPage,
  open,
}: {
  filters: LeadBoardFilters;
  onFilter: (value: LeadBoardFilters) => void;
  page: number;
  active: boolean;
  setPage: (page: number) => void;
  open: (id: string, stage?: string) => void;
}) {
  const { search, segment, stage } = filters;
  const [create, setCreate] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    () => matchMedia("(max-width: 1000px)").matches,
  );
  const [layout, setLayout] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<{
    key: string;
    revision: number;
    page: number;
    result: LeadPage;
  }>();
  const key = JSON.stringify(filters);
  const visible = data?.key === key ? data.result : undefined;
  const loading =
    !visible || data?.revision !== revision || data?.page !== page;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const media = matchMedia("(max-width: 1000px)");
    const match = () => setIsNarrow(media.matches);
    media.addEventListener("change", match);
    return () => media.removeEventListener("change", match);
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setError("");
        void Promise.all(
          Array.from({ length: page }, (_, index) => {
            const query = new URLSearchParams({
              search,
              segment,
              stage,
              page: String(index + 1),
            });
            return api<LeadPage>(`/admin/crm/leads?${query}`, {
              signal: controller.signal,
            });
          }),
        )
          .then((pages) => {
            if (controller.signal.aborted) return;
            const items = new Map(
              pages.flatMap((value) =>
                value.items.map((lead) => [lead.id, lead] as const),
              ),
            );
            setData({
              key,
              revision,
              page,
              result: { items: [...items.values()], total: pages[0].total },
            });
          })
          .catch((issue: Error) => {
            if (!controller.signal.aborted) setError(issue.message);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, key, search, segment, stage, page, revision]);
  useLiveRefresh(refresh, false, active);

  function change<K extends keyof LeadBoardFilters>(
    field: K,
    value: LeadBoardFilters[K],
  ) {
    setError("");
    onFilter({ ...filters, [field]: value });
    setPage(1);
  }

  const asList = (layout || (isNarrow ? "list" : "board")) === "list";
  const items = visible?.items ?? [];
  const stages = LEAD_STAGES.filter((item) => !stage || item.id === stage);
  return (
    <main className="ops-page leads-page">
      <header className="ops-heading">
        <div>
          <h1>Leads</h1>
          <span>Consultas de clientes y seguimiento de obras</span>
        </div>
        <Button onClick={() => setCreate(true)} aria-haspopup="dialog">
          <Plus size={17} /> Registrar lead
        </Button>
      </header>
      {create && (
        <CreateLeadModal
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            setCreate(false);
            open(id);
          }}
        />
      )}
      <div className="ops-toolbar lead-tools">
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="Buscar leads"
            placeholder="Nombre, teléfono, correo o distrito"
            value={search}
            onChange={(event) => change("search", event.target.value)}
          />
        </label>
        <Select
          label="Etapa del lead"
          value={stage}
          onChange={(value) => change("stage", value)}
          options={[
            { value: "", label: "Todas las etapas" },
            ...LEAD_STAGES.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
        <Select
          label="Tipo de lead"
          value={segment}
          onChange={(value) => change("segment", value)}
          options={[
            { value: "", label: "Todos los tipos" },
            ...LEAD_SEGMENTS.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
        <div className="lead-view-actions">
          <div className="lead-layout" role="group" aria-label="Vista de leads">
            {layoutOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={asList === (value === "list")}
                onClick={() => setLayout(value)}
              >
                {value === "list" ? <List size={15} /> : <Kanban size={15} />}{" "}
                {label}
              </button>
            ))}
          </div>
          <button
            className="ops-icon-button"
            onClick={refresh}
            aria-label="Actualizar leads"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      {error && (
        <Notice error>
          {error}{" "}
          <button type="button" onClick={refresh}>
            Reintentar
          </button>
        </Notice>
      )}
      {loading && !error && (
        <p className="hint" role="status">
          {visible ? "Actualizando leads…" : "Buscando leads…"}
        </p>
      )}
      {visible &&
        (asList ? (
          items.length > 0 ? (
            <ul className="lead-list" aria-label="Lista de leads">
              {items.map((lead) => (
                <li key={lead.id}>
                  <LeadCard lead={lead} open={open} list />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-column-empty">No hay leads con estos filtros.</p>
          )
        ) : (
          <div className="ops-kanban" aria-label="Tablero de leads">
            {stages.map((column) => {
              const group = items.filter((lead) => lead.stage === column.id);
              return (
                <section
                  className={`ops-column stage-${column.id}`}
                  key={column.id}
                  aria-label={column.name}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const lead = items.find(
                      (row) =>
                        row.id === event.dataTransfer.getData("text/veca-lead"),
                    );
                    if (!lead || lead.stage === column.id) return;
                    const next =
                      lead.stage === "discarded"
                        ? "prelead"
                        : LEAD_STAGES[
                            LEAD_STAGES.findIndex(
                              (item) => item.id === lead.stage,
                            ) + 1
                          ]?.id;
                    if (column.id !== "discarded" && next !== column.id) {
                      setError(
                        "Avanza una etapa a la vez. Abre la ficha para continuar.",
                      );
                      return;
                    }
                    open(lead.id, column.id);
                  }}
                >
                  <header>
                    <span className="ops-stage-dot" />
                    <h2>{column.name}</h2>
                    <span>{group.length}</span>
                  </header>
                  <div className="ops-column-body">
                    {group.map((lead) => (
                      <LeadCard key={lead.id} lead={lead} open={open} />
                    ))}
                    {!group.length && (
                      <p className="ops-column-empty">
                        Sin leads en esta etapa
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ))}
      <div className="ops-board-bottom">
        {visible && (
          <span role="status">
            Mostrando {items.length} de {visible.total}{" "}
            {visible.total === 1 ? "lead" : "leads"}
          </span>
        )}
        {visible && items.length < visible.total && (
          <Button
            variant="ghost"
            disabled={loading && !error}
            onClick={() => setPage(page + 1)}
          >
            Cargar más
          </Button>
        )}
      </div>
    </main>
  );
}

function LeadCard({
  lead,
  open,
  list = false,
}: {
  lead: Lead;
  open: (id: string, stage?: string) => void;
  list?: boolean;
}) {
  const phone = lead.phone.replace(/[^\d+]/g, "");
  const whatsapp = phone.startsWith("+")
    ? phone.slice(1)
    : phone.length === 9
      ? "51" + phone
      : phone;
  const context = [
    lead.district,
    REQUEST_TYPES.find((item) => item.id === lead.requestType)?.name,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className="ops-lead-card"
      draggable={!list}
      onDragStart={(event) =>
        event.dataTransfer.setData("text/veca-lead", lead.id)
      }
    >
      <div className="lead-card-context">
        <span>
          {list ? stageName(lead.stage) : LEAD_SOURCE_LABELS[lead.source]}
        </span>
        {!list && <GripVertical size={14} />}
      </div>
      <button
        type="button"
        className="lead-card-open"
        onClick={() => open(lead.id)}
      >
        <strong>{lead.name}</strong>
        <ArrowRight size={16} />
      </button>
      {context && <p>{context}</p>}
      {lead.idea && <p className="ops-card-idea">{lead.idea}</p>}
      {lead.stageRequest?.status === "pending" && (
        <p className="lead-card-stage-request">
          Avance solicitado · Por aprobar
        </p>
      )}
      <div className="lead-card-actions">
        {phone && !isDemoLead(lead) && (
          <>
            <a href={`tel:${phone}`} aria-label={`Llamar a ${lead.name}`}>
              <Phone size={14} /> Llamar
            </a>
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Enviar WhatsApp a ${lead.name}`}
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
          </>
        )}
        {lead.stage === "prelead" && (
          <button type="button" onClick={() => open(lead.id, "contacted")}>
            Registrar contacto
          </button>
        )}
      </div>
    </article>
  );
}
