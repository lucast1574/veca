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
import { DispatchForm, newDispatch } from "./DispatchForm";
import { dispatchInput, transferLabel } from "./shared";
import "./dispatch.css";

export function LeadDispatches({
  lead,
  inventoryAccess,
}: {
  lead: Lead;
  inventoryAccess: boolean;
}) {
  const path = `/admin/crm/leads/${lead.id}/dispatches`;
  const [rows, setRows] = useState<Dispatch[] | null>(null);
  const [error, setError] = useState("");
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

  function open(row?: Dispatch) {
    editing.current = row || null;
    setInitial(row ? dispatchInput(row) : newDispatch(lead));
    if (inventoryAccess && !materials.length)
      void api<Material[]>("/admin/crm/materials")
        .then(setMaterials)
        .catch(() => {});
  }

  async function save(data: DispatchInput, submit: boolean) {
    const current = editing.current;
    const draft = current
      ? await api<Dispatch>(`${path}/${current.id}`, {
          method: "PUT",
          body: JSON.stringify({ version: current.version, data }),
        })
      : await post<Dispatch>(path, data);
    editing.current = draft;
    if (submit) {
      await post<Dispatch>(`${path}/${draft.id}/submit`, {
        version: draft.version,
      });
    }
    setInitial(null);
    await load();
  }

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
            <li key={row.id}>
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
