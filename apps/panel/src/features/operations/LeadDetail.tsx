import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  LEAD_STAGES,
  LEAD_SEGMENTS,
  REQUEST_TYPES,
  LEAD_SOURCE_LABELS,
  DEMO_CASES,
  isDemoLead,
  type LeadInput,
  type PhotoMetadata,
  type Lead,
  type Material,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Pencil,
  Save,
  Phone,
  Mail,
  Upload,
  FileText,
  RefreshCw,
  Plus,
} from "lucide-react";
import { api, post, API_BASE } from "../../lib/api";
import { DemoPhoto } from "../administration/DemoPhoto";
import { LeadDispatches } from "../dispatch/LeadDispatches";
import { Button, Field, Notice } from "../../components/ui";
import {
  amount,
  date,
  leadInput,
  stageName,
  Movements,
  type LeadDetailData,
  useMessage,
  useLiveRefresh,
} from "./shared";
import { PhotoMetadataFields } from "../gallery/PhotoMetadataFields";
import "../gallery/gallery.css";
import { MaterialMovement } from "./Inventory";
import { WorkInvoiceRequest } from "./WorkInvoiceRequest";
import { LeadStageDialog, stageAction } from "./LeadStageDialog";
import "./lead-detail.css";
const contracts = [
  { value: "pending", label: "Por definir" },
  { value: "preparing", label: "En preparación" },
  { value: "sent", label: "Enviado al cliente" },
  { value: "signed", label: "Firmado" },
  { value: "not_required", label: "No aplica" },
];
const phases = [
  "prelead",
  "contacted",
  "coordination",
  "execution",
  "completed",
];
export function LeadDetail({
  id,
  proposal,
  inventoryAccess = true,
  dispatchAccess = false,
  back,
}: {
  id: string;
  proposal?: string;
  inventoryAccess?: boolean;
  dispatchAccess?: boolean;
  back: () => void;
}) {
  const [data, setData] = useState<LeadDetailData | null>(null),
    [draft, setDraft] = useState<LeadInput | null>(null),
    [tab, setTab] = useState("overview"),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [transition, setTransition] = useState<LeadInput["stage"] | null>(null),
    [notice, setNotice] = useState(""),
    [materials, setMaterials] = useState<Material[]>([]),
    [movement, setMovement] = useState(false),
    [note, setNote] = useState(""),
    [photoMetadata, setPhotoMetadata] = useState<PhotoMetadata>({
      caption: "",
      tags: [],
      sharing: "internal",
    });
  const { error, setError, fail } = useMessage();
  const upload = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await api<LeadDetailData>(`/admin/crm/leads/${id}`);
      setData(next);
      setDraft(leadInput(next.lead));
      setError("");
    } catch (e) {
      fail(e);
    }
  }, [id]);
  useEffect(() => {
    void refresh();
    if (inventoryAccess)
      void api<Material[]>("/admin/crm/materials")
        .then(setMaterials)
        .catch(fail);
  }, [refresh]);
  useEffect(() => {
    if (!data || !proposal) return;
    const from = data.lead.stage;
    const next =
      from === "discarded" ? "prelead" : phases[phases.indexOf(from) + 1];
    if (proposal === next || (proposal === "discarded" && from !== "discarded"))
      setTransition(proposal as LeadInput["stage"]);
  }, [proposal, data?.lead.id]);
  const refreshRelated = useCallback(() => {
    void api<LeadDetailData>(`/admin/crm/leads/${id}`)
      .then((next) => {
        setData((old) =>
          old
            ? {
                ...old,
                attachments: next.attachments,
                movements: next.movements,
              }
            : old,
        );
        setDraft((old) => {
          if (old && next.lead.version !== old.version)
            setNotice(
              "La ficha cambió en otra sesión. Recárgala antes de guardar; tus cambios aún no se han enviado.",
            );
          return old;
        });
      })
      .catch(fail);
    if (inventoryAccess)
      void api<Material[]>("/admin/crm/materials")
        .then(setMaterials)
        .catch(fail);
  }, [id]);
  useLiveRefresh(refreshRelated);
  const dirty =
    !!data &&
    !!draft &&
    JSON.stringify(draft) !== JSON.stringify(leadInput(data.lead));
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: Event) => {
      if (dirty && !confirm("Hay cambios sin guardar. ¿Salir de la ficha?"))
        event.preventDefault();
    };
    window.addEventListener("veca-before-navigate", navigate);
    window.addEventListener("beforeunload", protect);
    return () => {
      window.removeEventListener("beforeunload", protect);
      window.removeEventListener("veca-before-navigate", navigate);
    };
  }, [dirty]);
  function patch<K extends keyof LeadInput>(key: K, value: LeadInput[K]) {
    setDraft((old) => (old ? { ...old, [key]: value } : old));
    setNotice("");
  }
  async function persist(next: LeadInput) {
    const saved = await api<Lead>(`/admin/crm/leads/${id}`, {
      method: "PUT",
      body: JSON.stringify(next),
    });
    setData((old) => (old ? { ...old, lead: saved } : old));
    setDraft(leadInput(saved));
    return saved;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      await persist(draft);
      setEditing(false);
      setNotice("Ficha guardada.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const lead = await post<Lead>(`/admin/crm/leads/${id}/notes`, {
        version: draft.version,
        text: note,
      });
      setNote("");
      setData((old) => (old ? { ...old, lead } : old));
      setDraft((old) => (old ? { ...old, version: lead.version } : old));
      setNotice("Nota registrada.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function file(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", photoMetadata.caption);
      form.append("tags", JSON.stringify(photoMetadata.tags));
      form.append("sharing", photoMetadata.sharing);
      await api(`/admin/crm/leads/${id}/files`, { method: "POST", body: form });
      const attachments = await api<LeadDetailData>(`/admin/crm/leads/${id}`);
      setData((old) =>
        old ? { ...old, attachments: attachments.attachments } : old,
      );
      setPhotoMetadata({ caption: "", tags: [], sharing: "internal" });
      setNotice("Archivo añadido a la ficha.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  }
  if (!data || !draft)
    return (
      <main className="ops-page">
        {error ? <Notice error>{error}</Notice> : <p>Cargando ficha…</p>}
        <Button
          variant="ghost"
          onClick={() => {
            if (
              !dirty ||
              confirm("Hay cambios sin guardar. ¿Salir de la ficha?")
            )
              back();
          }}
        >
          Volver al tablero
        </Button>
      </main>
    );
  const lead = data.lead;
  const index = phases.indexOf(lead.stage);
  const nextStage = (
    lead.stage === "discarded" ? "prelead" : phases[index + 1]
  ) as LeadInput["stage"] | undefined;
  const demo = isDemoLead(lead);
  const demoCase = demo
    ? DEMO_CASES.find((item) => item.name === lead.name)
    : undefined;
  const displayName = lead.name.replace(/^\[demo\]\s*/i, "");
  const request = REQUEST_TYPES.find(
    (item) => item.id === lead.requestType,
  )?.name;
  const tabs = [
    ["overview", "Resumen"],
    ["work", "Obra"],
    ["files", "Archivos"],
    ["materials", "Materiales"],
    ["history", "Historial"],
  ].filter(([value]) => value !== "materials" || inventoryAccess);
  const formField = (key: keyof LeadInput, label: string, type = "text") => (
    <Field label={label}>
      <input
        type={type}
        onInput={
          type === "datetime-local"
            ? (e) => patch(key, e.currentTarget.value as never)
            : undefined
        }
        value={String(draft[key] ?? "")}
        onChange={(e) => patch(key, e.target.value as never)}
        maxLength={key === "workPlan" ? 6000 : 500}
      />
    </Field>
  );
  const area = (key: keyof LeadInput, label: string, rows = 3) => (
    <Field label={label}>
      <textarea
        rows={rows}
        value={String(draft[key] ?? "")}
        onChange={(e) => patch(key, e.target.value as never)}
        maxLength={6000}
      />
    </Field>
  );
  return (
    <main className="ops-page ops-detail">
      <div className="lead-detail-top">
        <button
          className="ops-back"
          onClick={() => {
            if (
              !dirty ||
              confirm("Hay cambios sin guardar. ¿Salir de la ficha?")
            )
              back();
          }}
        >
          <ArrowLeft size={17} /> Leads
        </button>
        <button
          className="ops-icon-button"
          title="Recargar ficha"
          aria-label="Recargar ficha"
          onClick={() => {
            if (
              !dirty ||
              confirm("Hay cambios sin guardar. ¿Recargar la ficha?")
            )
              void refresh();
          }}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <header className="lead-detail-hero">
        <div>
          <div className="lead-detail-labels">
            <span className="lead-detail-stage">{stageName(lead.stage)}</span>
            {demo && <span className="lead-detail-demo">Demostración</span>}
          </div>
          <h1>{displayName}</h1>
          <p>
            {[lead.district, request, lead.assignedTo]
              .filter(Boolean)
              .join(" · ") || LEAD_SOURCE_LABELS[lead.source]}
          </p>
        </div>
        {nextStage && (
          <Button
            disabled={busy || editing}
            onClick={() => {
              setError("");
              setNotice("");
              setTransition(nextStage);
            }}
          >
            {stageAction(nextStage)} <ArrowRight size={16} />
          </Button>
        )}
      </header>
      <ol className="lead-detail-progress" aria-label="Avance del lead">
        {LEAD_STAGES.slice(0, 5).map((stage, position) => (
          <li
            key={stage.id}
            data-reached={position <= index}
            aria-current={position === index ? "step" : undefined}
          >
            <span>
              {
                [
                  "Recibido",
                  "Contactado",
                  "Coordinación",
                  "En ejecución",
                  "Realizada",
                ][position]
              }
            </span>
          </li>
        ))}
      </ol>
      <nav className="lead-detail-tabs" aria-label="Secciones de la ficha">
        {tabs.map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {transition && (
        <LeadStageDialog
          stage={transition}
          initial={draft}
          onClose={() => setTransition(null)}
          onSave={async (next) => {
            const saved = await persist(next);
            setTransition(null);
            setNotice(`Etapa actualizada a «${stageName(saved.stage)}».`);
          }}
        />
      )}
      {error && <Notice error>{error}</Notice>}
      {notice && (
        <p role="status" className="ops-success">
          {notice}
        </p>
      )}
      {["overview", "work"].includes(tab) && !editing && (
        <div className="lead-detail-content">
          <section className="ops-card lead-detail-panel">
            <div className="lead-detail-section-head">
              <h2>
                {tab === "overview"
                  ? "Sobre esta oportunidad"
                  : "Coordinación y obra"}
              </h2>
              <Button variant="ghost" onClick={() => setEditing(true)}>
                <Pencil size={15} /> Editar datos
              </Button>
            </div>
            {tab === "overview" ? (
              <>
                <p className="lead-detail-copy">
                  {lead.idea || "Aún no hay una descripción."}
                </p>
                {lead.contactResult && (
                  <div className="lead-detail-followup">
                    <strong>Último acuerdo</strong>
                    <p>{lead.contactResult}</p>
                  </div>
                )}
              </>
            ) : (
              <dl className="lead-detail-facts">
                <div>
                  <dt>Cita</dt>
                  <dd>
                    {lead.appointment
                      ? date(lead.appointment)
                      : "Por programar"}
                  </dd>
                </div>
                <div>
                  <dt>Dirección</dt>
                  <dd>{lead.address || "Por definir"}</dd>
                </div>
                <div>
                  <dt>Alcance</dt>
                  <dd>{lead.workPlan || "Por definir"}</dd>
                </div>
                <div>
                  <dt>Contrato</dt>
                  <dd>
                    {
                      contracts.find(
                        (item) => item.value === lead.contractStatus,
                      )?.label
                    }
                    {lead.contractReference && ` · ${lead.contractReference}`}
                  </dd>
                </div>
                {lead.completionNote && (
                  <div>
                    <dt>Cierre</dt>
                    <dd>{lead.completionNote}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
          <aside className="ops-card lead-detail-panel">
            {tab === "overview" && demoCase && (
              <DemoPhoto demo={demoCase.key} />
            )}
            <h2>{tab === "overview" ? "Contacto" : "Seguimiento"}</h2>
            {tab === "overview" ? (
              <div className="lead-detail-links">
                {demo ? (
                  <span>Contacto ficticio</span>
                ) : (
                  <>
                    <a href={`tel:${lead.phone}`}>
                      <Phone size={16} />
                      {lead.phone}
                    </a>
                    <a href={`mailto:${lead.email}`}>
                      <Mail size={16} />
                      {lead.email}
                    </a>
                  </>
                )}
                <span>
                  {LEAD_SOURCE_LABELS[lead.source]} · {date(lead.createdAt)}
                </span>
              </div>
            ) : (
              <>
                <p className="lead-detail-inline">
                  <CalendarDays size={17} />
                  {lead.appointment ? "Cita programada" : "Sin cita programada"}
                </p>
                {dispatchAccess && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("lead-dispatches")
                        ?.scrollIntoView({ block: "start" })
                    }
                  >
                    Ver despachos
                  </Button>
                )}
                {dispatchAccess &&
                  !demo &&
                  ["coordination", "execution", "completed"].includes(
                    lead.stage,
                  ) && <WorkInvoiceRequest id={id} />}
              </>
            )}
            {lead.stage !== "discarded" &&
              lead.stage !== "completed" &&
              tab === "overview" && (
                <Button
                  variant="ghost"
                  onClick={() => setTransition("discarded")}
                >
                  Descartar lead
                </Button>
              )}
          </aside>
        </div>
      )}
      {["overview", "work"].includes(tab) && editing && (
        <form
          onSubmit={save}
          className="ops-card lead-detail-panel lead-detail-edit"
        >
          <h2>
            {tab === "overview"
              ? "Editar oportunidad"
              : "Editar coordinación y obra"}
          </h2>
          <fieldset disabled={busy} className="lead-detail-fieldset">
            {tab === "overview" ? (
              <>
                <div className="ops-form-grid">
                  {formField("name", "Nombre y apellido")}
                  {formField("phone", "Teléfono", "tel")}
                  {formField("email", "Correo", "email")}
                  {formField("district", "Distrito")}
                  <Field label="Tipo de trabajo">
                    <Select
                      label="Tipo de trabajo"
                      value={draft.requestType}
                      onChange={(value) =>
                        patch("requestType", value as LeadInput["requestType"])
                      }
                      options={REQUEST_TYPES.map((type) => ({
                        value: type.id,
                        label: type.name,
                      }))}
                    />
                  </Field>
                  <Field label="Tipo de lead">
                    <Select
                      label="Tipo de lead"
                      value={draft.segment}
                      onChange={(value) =>
                        patch("segment", value as LeadInput["segment"])
                      }
                      options={LEAD_SEGMENTS.map((type) => ({
                        value: type.id,
                        label: type.name,
                      }))}
                    />
                  </Field>
                  {formField("assignedTo", "Responsable")}
                </div>
                {area("idea", "Consulta del cliente", 4)}
                {area("contactResult", "Último acuerdo")}
              </>
            ) : (
              <>
                <div className="ops-form-grid">
                  {formField(
                    "appointment",
                    "Cita de coordinación (hora de Lima)",
                    "datetime-local",
                  )}
                  {formField("address", "Dirección de la obra")}
                  <Field label="Estado del contrato">
                    <Select
                      label="Estado del contrato"
                      value={draft.contractStatus}
                      options={contracts}
                      onChange={(value) =>
                        patch(
                          "contractStatus",
                          value as LeadInput["contractStatus"],
                        )
                      }
                    />
                  </Field>
                  {formField("contractReference", "Referencia del contrato")}
                </div>
                {area("workPlan", "Alcance de la obra", 4)}
                {area("completionNote", "Resultado de la obra")}
              </>
            )}
          </fieldset>
          <div className="lead-detail-edit-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(leadInput(lead));
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
            <Button disabled={busy}>
              <Save size={16} />
              {busy ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </form>
      )}
      {tab === "files" && (
        <section className="ops-card">
          {demoCase && (
            <div className="lead-demo-gallery">
              <DemoPhoto demo={demoCase.key} />
            </div>
          )}
          <div className="ops-card-heading">
            <div>
              <h2>Fotos de obra y contratos</h2>
              <p className="hint">
                Archivos privados. Añadirlos aquí no los publica en la landing.
              </p>
            </div>
            <Button disabled={busy} onClick={() => upload.current?.click()}>
              <Upload size={16} />
              {busy ? "Subiendo…" : "Añadir archivo"}
            </Button>
          </div>
          <fieldset className="gallery-edit-fields" disabled={busy}>
            <PhotoMetadataFields
              value={photoMetadata}
              onChange={setPhotoMetadata}
            />
            <p className="hint">
              Las fotos aparecerán en la Galería. En contratos PDF solo se
              guarda la descripción.
            </p>
          </fieldset>
          <input
            ref={upload}
            className="ops-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void file(selected);
            }}
          />
          <div className="ops-files">
            {data.attachments.map((a) => (
              <a
                key={a.id}
                href={API_BASE + a.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {a.type === "photo" ? (
                  <img src={API_BASE + a.url} alt={a.caption || a.name} />
                ) : (
                  <div className="ops-pdf">
                    <FileText size={36} />
                    <span>Contrato PDF</span>
                  </div>
                )}
                <strong>{a.caption || a.name}</strong>
                <small>{date(a.createdAt)}</small>
                {a.type === "photo" && (
                  <small>
                    {a.sharing === "clients"
                      ? "Autorizada para mostrar a clientes"
                      : "Solo uso interno"}
                    {a.tags.length ? " · " + a.tags.join(" · ") : ""}
                  </small>
                )}
              </a>
            ))}
          </div>
          {!data.attachments.length && (
            <p className="ops-empty-small">
              Documenta el antes, el avance y el resultado de la obra. También
              puedes añadir contratos PDF.
            </p>
          )}
        </section>
      )}
      {tab === "work" && dispatchAccess && (
        <div id="lead-dispatches">
          <LeadDispatches lead={lead} inventoryAccess={inventoryAccess} />
        </div>
      )}
      {tab === "materials" && inventoryAccess && (
        <>
          <section className="ops-card">
            <div className="ops-card-heading">
              <div>
                <h2>Consumo y devoluciones</h2>
                <p className="hint">
                  El inventario se actualiza con cada movimiento confirmado. No
                  hay un segundo descuento al finalizar.
                </p>
              </div>
              <Button
                disabled={
                  !["execution", "completed"].includes(lead.stage) ||
                  !materials.length
                }
                onClick={() => setMovement(true)}
              >
                <Plus size={16} />
                Registrar uso
              </Button>
            </div>
            {!["execution", "completed"].includes(lead.stage) && (
              <p className="ops-empty-small">
                Esta opción se habilita cuando la obra está en ejecución.
              </p>
            )}
            {!materials.length && (
              <a href="#inventory">Añadir materiales al inventario</a>
            )}
            <Movements items={data.movements} />
          </section>
          {movement && (
            <MaterialMovement
              materials={materials}
              leadId={id}
              onCancel={() => setMovement(false)}
              onSaved={() => {
                setMovement(false);
                void api<Material[]>("/admin/crm/materials").then(setMaterials);
                void api<LeadDetailData>(`/admin/crm/leads/${id}`).then(
                  (next) =>
                    setData((old) =>
                      old ? { ...old, movements: next.movements } : old,
                    ),
                );
              }}
            />
          )}
        </>
      )}
      {tab === "history" && (
        <section className="ops-card">
          <h2>Historial de atención</h2>
          <form className="ops-note-form" onSubmit={addNote}>
            <textarea
              aria-label="Nueva nota de seguimiento"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Registra una llamada, acuerdo o avance…"
              required
              maxLength={4000}
              rows={3}
            />
            <Button disabled={busy}>Añadir nota</Button>
          </form>
          <ol className="ops-timeline">
            {[...lead.events].reverse().map((event, i) => (
              <li key={`${event.at}-${i}`}>
                <span>
                  {date(event.at)} · {event.actor}
                </span>
                <p>{event.text}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
