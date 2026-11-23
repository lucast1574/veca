import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import {
  DISPATCH_STATUS,
  GUIDE_UNITS,
  type Dispatch,
  type DispatchStatus,
} from "@veca/content";
import { Modal } from "../../components/Modal";
import { Select } from "@veca/ui/src/Select";
import { Button, Field, Notice } from "../../components/ui";
import { API_BASE, api, post } from "../../lib/api";
import {
  guidePath,
  motiveLabel,
  transferLabel,
  transportLabel,
} from "./shared";
import {
  inquiryTimeout,
  Pagination,
  QueryState,
  Refresh,
  useAccountingQuery,
} from "../accounting/accounting-shared";
import "./dispatch.css";

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
}: {
  selected: string;
  initialFilter?: string;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useAccountingQuery<QueuePage>(
    selected
      ? ""
      : `${guidePath}?status=${filter}&page=${page}&search=${encodeURIComponent(search.trim())}`,
  );
  const rows = query.data;
  if (selected) return <GuideReview key={selected} id={selected} />;
  return (
    <section aria-labelledby="accounting-guides">
      <div className="accounting-section-head">
        <h2 id="accounting-guides">Guías de remisión</h2>
        <div className="accounting-tools">
          <Select
            label="Estado de las guías"
            value={filter}
            options={[
              { value: "all", label: "Todas" },
              { value: "review", label: "Requieren atención" },
              { value: "issued", label: "Emitidas" },
            ]}
            onChange={(value) => {
              if (filter === value && page === 1) return;
              setFilter(value);
              setPage(1);
            }}
          />
          <Refresh loading={query.loading} onClick={query.refresh} />
        </div>
      </div>
      <div className="accounting-filters">
        <Field label="Buscar guías">
          <input
            type="search"
            placeholder="Obra, número de guía o destinatario"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </Field>
      </div>
      <QueryState {...query} empty="No hay guías para este filtro.">
        {rows && rows.items.length > 0 && (
          <ul className="dispatch-list dispatch-queue">
            {rows.items.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.workName}</strong>
                  <small>
                    {transportLabel(row.transportMode)}
                    {row.guideNumber && ` · ${row.guideNumber}`}
                  </small>
                </div>
                <div>{transferLabel(row.transferAt)}</div>
                <span className="dispatch-pill" data-state={row.status}>
                  {row.issue || DISPATCH_STATUS[row.status]}
                </span>
                <a
                  className="dispatch-link"
                  href={`#accounting/guias/${row.id}`}
                >
                  {row.status === "review" ? "Revisar" : "Ver despacho"}{" "}
                  <ChevronRight size={15} />
                </a>
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
    </section>
  );
}

function GuideReview({ id }: { id: string }) {
  const path = `${guidePath}/${id}`;
  const [data, setData] = useState<GuideDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [observation, setObservation] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<GuideDetail>(path, { signal: inquiryTimeout() }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);

  async function action(command: "return" | "issue" | "check") {
    if (!data || busy) return;
    setBusy(true);
    setConfirmIssue(false);
    setError("");
    try {
      const dispatch = await post<Dispatch>(`${path}/${command}`, {
        version: data.dispatch.version,
        ...(command === "return" ? { observation } : {}),
      });
      setData({ ...data, dispatch });
      setReturning(false);
      setObservation("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const row = data?.dispatch;
  const reviewable: DispatchStatus[] = ["review", "rejected"];
  const mayReturn = row && reviewable.includes(row.status);
  const canIssue =
    row?.status === "review" && !row.demo && !data?.issues.length;
  const external = row?.transportMode === "01";
  return (
    <section className="dispatch-review accounting-guide-review">
      <a className="dispatch-link" href="#accounting/guias">
        <ArrowLeft size={16} /> Volver a guías
      </a>
      {error && <Notice error>{error}</Notice>}
      {!row && !error && <p role="status">Cargando despacho…</p>}
      {row && (
        <div className="dispatch-stack">
          <div className="dispatch-toolbar">
            <div>
              <h1>{row.workName}</h1>
              <p className="hint">{transferLabel(row.transferAt)}</p>
            </div>
            <span className="dispatch-pill" data-state={row.status}>
              {DISPATCH_STATUS[row.status]}
            </span>
          </div>
          {row.demo && (
            <Notice>
              Despacho de demostración. La emisión está deshabilitada.
            </Notice>
          )}
          {row.observation && <Notice>{row.observation}</Notice>}
          {mayReturn && data.issues.length > 0 && (
            <div className="dispatch-card dispatch-issues">
              <h2>Datos por completar</h2>
              <ul>
                {data.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <section className="ops-card">
            <h2>Traslado</h2>
            <dl className="dispatch-grid">
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
              <dl className="dispatch-grid">
                <div>
                  <dt>Destinatario</dt>
                  <dd>{row.recipientName || "Sin nombre"}</dd>
                </div>
                <div>
                  <dt>
                    {row.recipientType === "6" ? "RUC" : "DNI"} del destinatario
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
          <section className="ops-card">
            <h2>Materiales</h2>
            <ul className="dispatch-list">
              {row.items.map((item, index) => (
                <li key={index}>
                  <span>
                    {item.code && `${item.code} · `}
                    {item.description}
                  </span>
                  <strong>
                    {item.quantity} ·{" "}
                    {
                      GUIDE_UNITS.find((unit) => unit.id === item.unitCode)
                        ?.name
                    }
                  </strong>
                </li>
              ))}
            </ul>
          </section>
          {confirmIssue && (
            <Modal
              title="Confirmar emisión"
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
                  <Button type="button" onClick={() => void action("issue")}>
                    Confirmar y emitir
                  </Button>
                </footer>
              }
            >
              <p>
                Se enviará la guía de <strong>{row.workName}</strong> para el
                traslado del {transferLabel(row.transferAt)}.
              </p>
            </Modal>
          )}
          {row.status === "sending" && (
            <Notice>
              El envío está en curso. Actualiza para comprobar el resultado.
            </Notice>
          )}
          {returning && (
            <form
              className="dispatch-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void action("return");
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
                  autoFocus
                />
              </Field>
              <div className="dispatch-actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setReturning(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  Enviar observación
                </Button>
              </div>
            </form>
          )}
          {!returning && (
            <div className="dispatch-actions">
              {mayReturn && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setReturning(true)}
                >
                  Devolver a Operaciones
                </Button>
              )}
              {canIssue && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmIssue(true)}
                >
                  {busy ? "Enviando…" : "Emitir guía"}
                </Button>
              )}
              {row.canCheckStatus && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void action("check")}
                >
                  Actualizar estado
                </Button>
              )}
              {row.status === "sending" && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void load()}
                >
                  Actualizar estado
                </Button>
              )}
              {["accepted", "observed"].includes(row.status) && (
                <a className="dispatch-link" href={`${API_BASE}${path}/pdf`}>
                  Descargar guía {row.guideNumber}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
