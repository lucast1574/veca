import { DiscardGuideDialog } from "./DiscardGuideDialog";
import { useAccountingPermission } from "../accounting/AccountingAccess";
import { useId, useRef, useState } from "react";
import { ChevronRight, Download, Plus } from "lucide-react";
import {
  DISPATCH_STATUS,
  guideItemDescription,
  type Dispatch,
} from "@veca/content";
import { Modal } from "../../components/Modal";
import { Select } from "@veca/ui/src/Select";
import { Button, Field, Notice } from "../../components/ui";
import { API_BASE, api } from "../../lib/api";
import {
  dispatchInput,
  guidePath,
  motiveLabel,
  transferLabel,
  transportLabel,
} from "./shared";
import {
  accountingPost,
  Pagination,
  QueryState,
  Refresh,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import { GuideDraftForm, NewGuide } from "./GuideDraftForm";
import "../accounting/accounting-records.css";
import "./dispatch.css";

const guideUnits: Record<Dispatch["items"][number]["unitCode"], string> = {
  NIU: "ud.",
  MTR: "m",
  MTK: "m²",
  KGM: "kg",
  LTR: "L",
  SET: "juego",
};

type QueueRow = Pick<
  Dispatch,
  | "id"
  | "workName"
  | "status"
  | "demo"
  | "guideNumber"
  | "transferAt"
  | "transportMode"
>;
type QueuePage = { items: (QueueRow & { issue: string })[]; hasMore: boolean };
type GuideDetail = { dispatch: Dispatch; issues: string[] };

export function GuideAccounting({
  selected,
  initialFilter = "all",
  inventoryAccess,
}: {
  selected: string;
  initialFilter?: string;
  inventoryAccess: boolean;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openGuide, setOpenGuide] = useState<string>();
  const detailId = openGuide || selected;
  const query = useAccountingQuery<QueuePage>(
    `${guidePath}?status=${filter}&page=${page}&search=${encodeURIComponent(search.trim())}`,
  );
  const rows = query.data;
  return (
    <section aria-labelledby="accounting-guides">
      <div className="accounting-section-head">
        <h2 id="accounting-guides">Guías de remisión</h2>
        <Button
          type="button"
          disabled={!canWrite}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} aria-hidden="true" /> Nueva guía
        </Button>
      </div>
      <div className="guide-queue-filters">
        <Field label="Buscar guías">
          <input
            type="search"
            placeholder="Obra, número o destinatario"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </Field>
        <Field label="Estado de las guías" htmlFor="guide-queue-status">
          <Select
            id="guide-queue-status"
            label="Estado de las guías"
            value={filter}
            options={[
              { value: "all", label: "Todas" },
              { value: "draft", label: "Borradores" },
              { value: "review", label: "Requieren atención" },
              { value: "issued", label: "Emitidas" },
            ]}
            onChange={(value) => {
              if (filter === value && page === 1) return;
              setFilter(value);
              setPage(1);
            }}
          />
        </Field>
        <Refresh loading={query.loading} onClick={query.refresh} />
      </div>
      <QueryState
        {...query}
        empty={
          filter === "all" && !search.trim()
            ? "Aún no hay guías de remisión."
            : "No hay guías para este filtro."
        }
      >
        {rows && rows.items.length > 0 && (
          <ul className="accounting-record-list">
            {rows.items.map((row) => (
              <li key={row.id}>
                <div className="accounting-record-label">
                  <strong>{row.workName}</strong>
                  <small>
                    {row.guideNumber ? `${row.guideNumber} · ` : ""}
                    {transportLabel(row.transportMode)}
                  </small>
                  {row.issue && row.issue !== DISPATCH_STATUS[row.status] && (
                    <small>{row.issue}</small>
                  )}
                </div>
                <div className="accounting-record-meta">
                  <span>{transferLabel(row.transferAt)}</span>
                  <span
                    className="accounting-record-status"
                    data-state={row.status}
                  >
                    {DISPATCH_STATUS[row.status]}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpenGuide(row.id)}
                >
                  Ver detalle <ChevronRight size={14} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <Pagination
        page={page}
        hasMore={Boolean(rows?.hasMore)}
        change={setPage}
      />
      {creating && (
        <NewGuide
          inventoryAccess={inventoryAccess}
          onClose={() => setCreating(false)}
          onCreate={(id) => {
            setCreating(false);
            setOpenGuide(id);
            query.refresh();
          }}
        />
      )}
      {detailId && (
        <GuideReview
          key={detailId}
          id={detailId}
          inventoryAccess={inventoryAccess}
          onChanged={query.refresh}
          onClose={() => {
            if (openGuide) setOpenGuide(undefined);
            else location.hash = "accounting/guias";
          }}
        />
      )}
    </section>
  );
}

function GuideReview({
  id,
  inventoryAccess,
  onChanged,
  onClose,
}: {
  id: string;
  inventoryAccess: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const mayIssue = useAccountingPermission("accounting_issue");
  const hasWorks = useAccountingPermission("works");
  const canManageWorks = useAccountingPermission("works_manage");
  const canDispatch = useAccountingPermission("dispatches");
  const path = `${guidePath}/${id}`;
  const query = useAccountingQuery<GuideDetail>(path);
  const [updated, setUpdated] = useState<GuideDetail>();
  const data = updated || query.data;
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<"return" | "issue" | "check">();
  const inFlight = useRef(false);
  const busy = Boolean(operation);
  const [discarding, setDiscarding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [editing, setEditing] = useState(false);
  const [observation, setObservation] = useState("");
  const returnFormId = useId();

  function refresh() {
    setUpdated(undefined);
    query.refresh();
    onChanged();
  }

  async function action(command: "return" | "issue" | "check") {
    if (!data || inFlight.current) return;
    inFlight.current = true;
    setOperation(command);
    setConfirmIssue(false);
    setError("");
    try {
      const dispatch = await accountingPost<Dispatch>(`${path}/${command}`, {
        version: data.dispatch.version,
        ...(command === "return" ? { observation: observation.trim() } : {}),
      });
      setUpdated({ ...data, dispatch });
      setReturning(false);
      setObservation("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      if (command === "issue") refresh();
    } finally {
      inFlight.current = false;
      setOperation(undefined);
    }
  }

  const row = data?.dispatch;
  const mayEdit =
    canWrite &&
    row?.createdInAccounting &&
    ["draft", "rejected"].includes(row.status);
  const mayReturn =
    canWrite &&
    row &&
    !row.createdInAccounting &&
    ["review", "rejected"].includes(row.status);
  const awaitingIssue =
    row && row.status === (row.createdInAccounting ? "draft" : "review");
  const showIssue = mayIssue && awaitingIssue && !row.demo;
  const needsData = Boolean(data?.issues.length);
  const canIssue = showIssue && !needsData;
  const needsOperations =
    row &&
    !row.createdInAccounting &&
    ["draft", "returned"].includes(row.status);
  const canOpenDispatch =
    needsOperations && hasWorks && canManageWorks && canDispatch;
  const external = row?.transportMode === "01";
  const issued = row && ["accepted", "observed"].includes(row.status);
  const mayDiscard =
    canWrite &&
    row &&
    ["draft", "review", "returned", "rejected"].includes(row.status);
  function closeReturn() {
    setReturning(false);
    setError("");
  }
  return (
    <>
      <Modal
        title={row?.workName || "Detalle de la guía"}
        description={
          row
            ? [row.guideNumber, transferLabel(row.transferAt)]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        busy={busy}
        onClose={onClose}
        footer={
          row && (
            <footer className="ve-modal-actions guide-detail-actions">
              {awaitingIssue && !row.demo && !mayIssue && (
                <p className="hint guide-action-hint">
                  La guía debe enviarla alguien con permiso de emisión.
                </p>
              )}
              {showIssue && needsData && (
                <p className="hint guide-action-hint">
                  Completa los datos señalados para emitir la guía.
                </p>
              )}
              {canOpenDispatch && (
                <a className="btn btn-ghost" href={`#works/${row.leadId}/work`}>
                  Abrir despacho en la obra
                </a>
              )}
              {mayReturn && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setObservation("");
                    setReturning(true);
                  }}
                >
                  Devolver a Operaciones
                </Button>
              )}
              {mayEdit && (
                <Button
                  type="button"
                  variant={canIssue ? "ghost" : "primary"}
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  {row.status === "rejected"
                    ? "Corregir guía"
                    : "Editar borrador"}
                </Button>
              )}
              {showIssue && (
                <Button
                  type="button"
                  disabled={
                    !canIssue || busy || query.loading || Boolean(query.error)
                  }
                  onClick={() => setConfirmIssue(true)}
                >
                  {operation === "issue" ? "Enviando…" : "Emitir guía"}
                </Button>
              )}
              {mayIssue && row.canCheckStatus && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void action("check")}
                >
                  Consultar estado en SUNAT
                </Button>
              )}
              {row.status === "sending" && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={query.loading}
                  onClick={refresh}
                >
                  Actualizar estado
                </Button>
              )}
              {issued && (
                <a
                  className="btn btn-ghost"
                  href={`${API_BASE}${path}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={16} aria-hidden="true" /> Descargar guía (PDF)
                </a>
              )}
              {!(
                mayReturn ||
                mayEdit ||
                showIssue ||
                canOpenDispatch ||
                (mayIssue && row.canCheckStatus) ||
                row.status === "sending" ||
                issued
              ) && (
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cerrar
                </Button>
              )}
            </footer>
          )
        }
      >
        <QueryState {...query}>
          {row && (
            <div className="dispatch-stack guide-detail-content">
              <div>
                <span
                  className="accounting-record-status"
                  data-state={row.status}
                >
                  {DISPATCH_STATUS[row.status]}
                </span>
              </div>
              {error && !returning && <Notice error>{error}</Notice>}
              {needsOperations && (
                <Notice>
                  Operaciones debe abrir el despacho y enviarlo a Contabilidad
                  para revisión.
                </Notice>
              )}
              {row.demo && (
                <Notice>
                  Despacho de demostración. La emisión está deshabilitada.
                </Notice>
              )}
              {row.observation && (
                <Notice
                  error={row.status === "rejected" || row.status === "returned"}
                >
                  {row.observation}
                </Notice>
              )}
              {row.status === "pending" && !row.observation && (
                <p className="hint">
                  {mayIssue && row.canCheckStatus
                    ? "SUNAT aún no confirma la guía. Usa Consultar estado en SUNAT."
                    : "El envío sigue sin confirmarse. Verifica si la guía figura en SUNAT antes de preparar otra."}
                </p>
              )}
              {(mayReturn || awaitingIssue) && needsData && (
                <div className="dispatch-card dispatch-issues">
                  <h3>Datos por completar</h3>
                  <p className="hint">
                    {mayEdit
                      ? "Abre el borrador para corregirlos."
                      : mayReturn
                        ? "Devuelve la guía a Operaciones con lo que falta."
                        : "Pide al equipo responsable que complete los datos."}
                  </p>
                  <ul>
                    {data.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              <section className="guide-detail-section">
                <h3>Traslado</h3>
                <dl className="accounting-record-facts">
                  <div>
                    <dt>Origen</dt>
                    <dd>
                      {row.startAddress || "Sin dirección"}
                      {row.startUbigeo && ` · ${row.startUbigeo}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Destino</dt>
                    <dd>
                      {row.arrivalAddress || "Sin dirección"}
                      {row.arrivalUbigeo && ` · ${row.arrivalUbigeo}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Motivo</dt>
                    <dd>
                      {row.motiveCode === "13"
                        ? row.motiveDescription || "Sin detalle"
                        : motiveLabel(row.motiveCode)}
                    </dd>
                  </div>
                  <div>
                    <dt>Transporte</dt>
                    <dd>
                      {transportLabel(row.transportMode)} · {row.weightKg} kg
                    </dd>
                  </div>
                </dl>
                <details open={Boolean(data.issues.length)}>
                  <summary>Destinatario y transporte</summary>
                  <dl className="accounting-record-facts">
                    <div>
                      <dt>Destinatario</dt>
                      <dd>{row.recipientName || "Sin nombre"}</dd>
                    </div>
                    <div>
                      <dt>
                        {row.recipientType === "6" ? "RUC" : "DNI"} del
                        destinatario
                      </dt>
                      <dd>{row.recipientNumber || "Sin documento"}</dd>
                    </div>
                    {external ? (
                      <>
                        <div>
                          <dt>Transportista</dt>
                          <dd>{row.carrierName || "Sin razón social"}</dd>
                        </div>
                        <div>
                          <dt>RUC del transportista</dt>
                          <dd>{row.carrierRuc || "Sin RUC"}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <dt>Placa</dt>
                          <dd>{row.vehiclePlate || "Sin placa"}</dd>
                        </div>
                        <div>
                          <dt>Conductor</dt>
                          <dd>
                            {[row.driverName, row.driverLastName]
                              .filter(Boolean)
                              .join(" ") || "Sin nombre"}
                          </dd>
                        </div>
                        <div>
                          <dt>DNI del conductor</dt>
                          <dd>{row.driverDocument || "Sin DNI"}</dd>
                        </div>
                        <div>
                          <dt>Licencia</dt>
                          <dd>{row.driverLicense || "Sin licencia"}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </details>
              </section>
              <section className="guide-detail-section">
                <h3>Materiales</h3>
                {row.items.length === 0 && (
                  <p className="hint">Aún no hay materiales en la guía.</p>
                )}
                <ul className="dispatch-list">
                  {row.items.map((item, index) => (
                    <li key={index}>
                      <span>
                        {item.code && `${item.code} · `}
                        {guideItemDescription(item)}
                      </span>
                      <strong>
                        {item.quantity} {guideUnits[item.unitCode]}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
              {row.status === "sending" && (
                <Notice>
                  La guía se está enviando. Pulsa Actualizar estado para ver el
                  resultado.
                </Notice>
              )}
              {mayDiscard && (
                <button
                  type="button"
                  className="dispatch-link guide-discard-link"
                  disabled={busy}
                  onClick={() => setDiscarding(true)}
                >
                  Descartar preparación
                </button>
              )}
            </div>
          )}
        </QueryState>
      </Modal>
      {row && editing && mayEdit && (
        <GuideDraftForm
          workName={row.workName}
          inventoryAccess={inventoryAccess}
          initial={dispatchInput(row)}
          onClose={() => setEditing(false)}
          onSave={async (values) => {
            setUpdated(
              await api<GuideDetail>(path, {
                method: "PUT",
                body: JSON.stringify({ data: values, version: row.version }),
              }),
            );
            setError("");
            setEditing(false);
            onChanged();
          }}
        />
      )}
      {row && confirmIssue && (
        <Modal
          title="Confirmar emisión"
          description={`${row.workName} · ${transferLabel(row.transferAt)}`}
          onClose={() => setConfirmIssue(false)}
          footer={
            <footer className="ve-modal-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmIssue(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!canIssue}
                onClick={() => void action("issue")}
              >
                Confirmar y emitir
              </Button>
            </footer>
          }
        >
          <p>Se enviará esta guía a SUNAT.</p>
        </Modal>
      )}
      {returning && (
        <Modal
          title="Devolver a Operaciones"
          description="Indica qué debe corregir el equipo antes de volver a enviarla."
          busy={busy}
          onClose={closeReturn}
          footer={
            <footer className="ve-modal-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={closeReturn}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form={returnFormId}
                disabled={busy || observation.trim().length < 3}
              >
                {busy ? "Enviando…" : "Enviar observación"}
              </Button>
            </footer>
          }
        >
          <form
            id={returnFormId}
            onSubmit={(event) => {
              event.preventDefault();
              if (observation.trim().length >= 3) void action("return");
            }}
          >
            <Field label="Qué necesita corregir Operaciones">
              <textarea
                rows={3}
                minLength={3}
                maxLength={500}
                required
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
              />
            </Field>
            {error && <Notice error>{error}</Notice>}
          </form>
        </Modal>
      )}
      {row && discarding && (
        <DiscardGuideDialog
          path={`${path}/discard`}
          version={row.version}
          close={() => setDiscarding(false)}
          done={() => {
            setDiscarding(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
