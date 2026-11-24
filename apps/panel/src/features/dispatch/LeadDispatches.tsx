import { useCallback, useEffect, useRef, useState } from "react";
import { Truck } from "lucide-react";
import {
  DISPATCH_STATUS,
  type Dispatch,
  type DispatchInput,
  type Lead,
  type Material,
} from "@veca/content";
import { Button, Notice } from "../../components/ui";
import { API_BASE, api, post } from "../../lib/api";
import { WarehouseForm } from "../warehouse/shared";
import { DispatchForm, newDispatch } from "./DispatchForm";
import { dispatchInput, transferLabel } from "./shared";
import "./dispatch.css";

export function LeadDispatches({
  lead,
  inventoryAccess,
  canDepart = false,
  dispatchId,
}: {
  lead: Lead;
  inventoryAccess: boolean;
  canDepart?: boolean;
  dispatchId?: string;
}) {
  const path = `/admin/crm/leads/${lead.id}/dispatches`;
  const [rows, setRows] = useState<Dispatch[] | null>(null);
  const [departing, setDeparting] = useState<Dispatch>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initial, setInitial] = useState<DispatchInput | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const editing = useRef<Dispatch | null>(null);
  const mayPrepare = ["coordination", "execution"].includes(lead.stage);
  const load = useCallback(async () => {
    try {
      setRows(await api<Dispatch[]>(path));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);

  async function depart(row: Dispatch) {
    const next = await api<Dispatch>(`${path}/${row.id}/depart`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
    });
    setRows(
      (current) =>
        current?.map((item) => (item.id === row.id ? next : item)) || null,
    );
    setDeparting(undefined);
  }

  function open(row?: Dispatch) {
    editing.current = row || null;
    setInitial(row ? dispatchInput(row) : newDispatch(lead));
    if (inventoryAccess && !materials.length)
      void api<Material[]>("/admin/crm/materials")
        .then(setMaterials)
        .catch(() => {});
  }

  async function save(
    data: DispatchInput,
    submit: boolean,
    unchanged: boolean,
  ) {
    setNotice("");
    const current = editing.current;
    const draft = current
      ? unchanged
        ? current
        : await api<Dispatch>(`${path}/${current.id}`, {
            method: "PUT",
            body: JSON.stringify({ version: current.version, data }),
          })
      : await post<Dispatch>(path, data);
    editing.current = draft;
    if (submit) {
      try {
        await post<Dispatch>(`${path}/${draft.id}/submit`, {
          version: draft.version,
        });
      } catch (error) {
        const rows = await api<Dispatch[]>(path).catch(() => null);
        const updated = rows?.find((row) => row.id === draft.id);
        if (rows) setRows(rows);
        if (!updated || updated.version === draft.version)
          return { sendError: (error as Error).message };
        setInitial(null);
        if (updated.status === "review") {
          setNotice("El despacho está en revisión de Contabilidad.");
        } else {
          setError(
            "El despacho cambió en otra sesión. Revisa la versión actual antes de enviarlo.",
          );
        }
        return;
      }
    }
    setInitial(null);
    setNotice(
      submit
        ? "Despacho enviado a Contabilidad para revisión."
        : "Borrador de despacho guardado.",
    );
    await load();
  }

  useEffect(() => {
    if (!dispatchId || !rows?.some((row) => row.id === dispatchId)) return;
    const row = document.getElementById(`dispatch-${dispatchId}`);
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  }, [dispatchId, rows]);

  return (
    <section className="ops-card dispatch-lead">
      <div className="dispatch-toolbar">
        <h2>Despachos</h2>
        <div className="dispatch-actions">
          <Button type="button" variant="ghost" onClick={() => void load()}>
            Actualizar
          </Button>
          {mayPrepare && (
            <Button type="button" onClick={() => open()}>
              <Truck size={16} /> Preparar despacho
            </Button>
          )}
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {!error && !rows && <p role="status">Cargando despachos…</p>}
      {rows?.length === 0 && (
        <p className="hint">
          {mayPrepare
            ? "Aún no hay despachos para esta obra."
            : "Puedes preparar un despacho desde la etapa de coordinación."}
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="dispatch-list">
          {rows.map((row) => (
            <li
              id={`dispatch-${row.id}`}
              key={row.id}
              tabIndex={dispatchId === row.id ? -1 : undefined}
            >
              <div>
                <strong>{transferLabel(row.transferAt)}</strong>
                <small>
                  {row.guideNumber || row.arrivalAddress || "Despacho a obra"}
                </small>
                {row.observation && <p>{row.observation}</p>}
              </div>
              <div className="dispatch-actions">
                <span className="dispatch-pill" data-state={row.status}>
                  {DISPATCH_STATUS[row.status]}
                </span>
                {mayPrepare && ["draft", "returned"].includes(row.status) && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => open(row)}
                  >
                    Editar despacho
                  </Button>
                )}
                {row.departedAt && (
                  <span className="dispatch-pill" data-state="accepted">
                    Salida confirmada
                  </span>
                )}
                {canDepart &&
                  !row.demo &&
                  !row.departedAt &&
                  ["accepted", "observed"].includes(row.status) && (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={Boolean(departing)}
                      onClick={() => setDeparting(row)}
                    >
                      Confirmar salida
                    </Button>
                  )}
                {["accepted", "observed"].includes(row.status) && (
                  <a
                    className="dispatch-link"
                    href={`${API_BASE}${path}/${row.id}/pdf`}
                  >
                    Descargar guía
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {departing && (
        <WarehouseForm
          title="Confirmar salida del despacho"
          action="Confirmar salida"
          onClose={() => setDeparting(undefined)}
          save={() => depart(departing)}
        >
          <p className="hint">
            {departing.items.some((item) => item.materialId)
              ? "Los materiales vinculados se moverán del almacén a la obra."
              : "Se registrará la salida física de este despacho."}
          </p>
        </WarehouseForm>
      )}
      {initial && (
        <DispatchForm
          initial={initial}
          materials={materials}
          onClose={() => setInitial(null)}
          onSave={save}
        />
      )}
    </section>
  );
}
