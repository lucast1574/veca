import { useRef, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import type { WorkPayrollIncident } from "@veca/content";
import { Button, Field, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import {
  amount,
  today,
  useAccountingQuery,
  recordId,
} from "../accounting/accounting-shared";
import { WarehouseForm, stringField } from "../warehouse/shared";
import { incidentState } from "../accounting/labor/PersonnelDialogs";
import "../accounting/labor/personnel.css";
type Data = {
  canManage: boolean;
  employeeError?: string;
  employees: { id: string; name: string; position: string }[];
  items: WorkPayrollIncident[];
};
export function WorkPayrollIncidents({ workId }: { workId: string }) {
  const path = `/admin/works/${workId}/payroll-incidents`;
  const query = useAccountingQuery<Data>(path);
  const [dialog, setDialog] = useState<
    "create" | { action: "authorize" | "cancel"; row: WorkPayrollIncident }
  >();
  const [feedback, setFeedback] = useState("");
  const done = () => {
    setDialog(undefined);
    setFeedback(
      "Incidencia actualizada. Contabilidad la verá en el periodo indicado.",
    );
    query.refresh();
  };
  if (
    !query.loading &&
    !query.error &&
    !query.data?.canManage &&
    !query.data?.items.length
  )
    return null;
  return (
    <section className="ops-card personnel-work">
      <header className="lead-detail-section-head">
        <div>
          <h2>
            <ClipboardList size={19} /> Incidencias de materiales
          </h2>
          <p className="hint">
            Registra desperdicios o daños y el seguimiento de un posible
            descuento.
          </p>
        </div>
        {query.data?.canManage && (
          <Button onClick={() => setDialog("create")}>
            <Plus size={15} />
            Registrar incidencia
          </Button>
        )}
      </header>
      {query.error && <Notice error>{query.error}</Notice>}
      {query.data?.employeeError && (
        <Notice error>{query.data.employeeError}</Notice>
      )}
      {feedback && <Notice>{feedback}</Notice>}
      {query.loading && !query.data && (
        <p className="hint">Cargando incidencias…</p>
      )}
      {!query.loading && !query.data?.items.length && (
        <p className="hint">No hay incidencias registradas para esta obra.</p>
      )}
      <div className="personnel-incidents">
        {query.data?.items.map((i) => (
          <article key={i.id}>
            <header>
              <div>
                <strong>{i.employeeName}</strong>
                <small>
                  {i.item} ·{" "}
                  {i.quantityNote ||
                    (i.kind === "waste" ? "Desperdicio" : "Daño o rotura")}
                </small>
              </div>
              <strong>{amount(i.cents)}</strong>
            </header>
            <p>{i.reason}</p>
            <footer>
              <span
                className="labor-status"
                data-state={i.status === "authorized" ? "approved" : "draft"}
              >
                {incidentState(i)}
              </span>
              <small>
                Planilla {i.period} · {i.date}
              </small>
            </footer>
            {query.data?.canManage &&
              !i.payrollRunId &&
              i.status !== "cancelled" && (
                <div className="personnel-actions">
                  {i.status === "reported" && (
                    <Button
                      variant="ghost"
                      onClick={() => setDialog({ action: "authorize", row: i })}
                    >
                      Registrar sustento
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ action: "cancel", row: i })}
                  >
                    Cancelar incidencia
                  </Button>
                </div>
              )}
          </article>
        ))}
      </div>
      {dialog === "create" && query.data && (
        <IncidentForm
          employees={query.data.employees}
          path={path}
          close={() => setDialog(undefined)}
          done={done}
        />
      )}
      {dialog && dialog !== "create" && (
        <WarehouseForm
          title={
            dialog.action === "authorize"
              ? "Sustento del descuento"
              : "Cancelar incidencia"
          }
          action={
            dialog.action === "authorize"
              ? "Autorizar para Planilla"
              : "Confirmar cancelación"
          }
          onClose={() => setDialog(undefined)}
          save={async (form) => {
            await api(path + `/${dialog.row.id}/${dialog.action}`, {
              method: "POST",
              body: JSON.stringify({
                revision: dialog.row.revision,
                ...(dialog.action === "authorize"
                  ? {
                      basis: stringField(form, "basis"),
                      reference: stringField(form, "reference"),
                      confirmed: form.has("confirmed"),
                    }
                  : {}),
              }),
            });
            done();
          }}
        >
          <div className="warehouse-preview">
            <strong>
              {dialog.row.employeeName} · {amount(dialog.row.cents)}
            </strong>
            <p>{dialog.row.item}</p>
          </div>
          {dialog.action === "authorize" ? (
            <>
              <p className="hint">
                Registra la autorización expresa del trabajador o el mandato
                aplicable. Contabilidad incorporará el importe en el borrador
                del periodo {dialog.row.period}.
              </p>
              <AuthorizationFields />
            </>
          ) : (
            <p>
              La incidencia conservará su historial y no se incorporará a
              Planilla.
            </p>
          )}
        </WarehouseForm>
      )}
    </section>
  );
}
function AuthorizationFields() {
  const [basis, setBasis] = useState("agreement");
  return (
    <>
      <Field label="Sustento">
        <Select
          floating
          name="basis"
          label="Sustento"
          value={basis}
          onChange={setBasis}
          options={[
            {
              value: "agreement",
              label: "Autorización expresa del trabajador",
            },
            { value: "order", label: "Mandato legal o judicial" },
          ]}
        />
      </Field>
      <Field
        label="Referencia del documento de sustento"
        hint="Ej.: Autorización firmada, acta y fecha. Conserva el documento con la obra."
      >
        <textarea
          name="reference"
          required
          minLength={5}
          maxLength={500}
          rows={2}
        />
      </Field>
      <label className="labor-check">
        <input name="confirmed" type="checkbox" required /> Confirmo que el
        descuento cuenta con el sustento indicado.
      </label>
    </>
  );
}
function IncidentForm({
  employees,
  path,
  close,
  done,
}: {
  employees: Data["employees"];
  path: string;
  close: () => void;
  done: () => void;
}) {
  const id = useRef(recordId());
  const [employee, setEmployee] = useState("");
  const [kind, setKind] = useState("waste");
  return (
    <WarehouseForm
      title="Registrar incidencia de materiales"
      action="Guardar incidencia"
      onClose={close}
      wide
      canSubmit={!!employee}
      save={async (form) => {
        await api(path, {
          method: "POST",
          body: JSON.stringify({
            id: id.current,
            employeeId: employee,
            kind,
            date: stringField(form, "date"),
            period: stringField(form, "period"),
            item: stringField(form, "item"),
            quantityNote: stringField(form, "quantity"),
            reason: stringField(form, "reason"),
            cents: Math.round(Number(form.get("amount")) * 100),
          }),
        });
        done();
      }}
    >
      <Field label="Trabajador de Planilla">
        <Select
          floating
          label="Trabajador de Planilla"
          value={employee}
          onChange={setEmployee}
          placeholder="Selecciona un trabajador"
          options={employees.map((e) => ({
            value: e.id,
            label: e.name,
            description: e.position,
          }))}
        />
      </Field>
      <div className="warehouse-grid">
        <Field label="Tipo de incidencia">
          <Select
            floating
            label="Tipo de incidencia"
            value={kind}
            onChange={setKind}
            options={[
              { value: "waste", label: "Desperdicio de material" },
              { value: "damage", label: "Daño o rotura" },
            ]}
          />
        </Field>
        <Field label="Fecha de la incidencia">
          <input type="date" name="date" defaultValue={today()} required />
        </Field>
        <Field label="Material o equipo afectado">
          <input name="item" required minLength={2} maxLength={180} />
        </Field>
        <Field label="Cantidad y unidad (opcional)">
          <input
            name="quantity"
            maxLength={100}
            placeholder="Ej.: 2 m² de vidrio"
          />
        </Field>
        <Field label="Importe por revisar (S/)">
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            max="10000000"
            required
          />
        </Field>
        <Field label="Periodo de Planilla">
          <input
            name="period"
            type="month"
            defaultValue={today().slice(0, 7)}
            required
          />
        </Field>
      </div>
      <Field label="Qué ocurrió y motivo de la asignación">
        <textarea
          name="reason"
          rows={3}
          minLength={8}
          maxLength={1500}
          required
        />
      </Field>
      <p className="hint">
        Guardar la incidencia no descuenta dinero. Después registra el sustento
        para que Contabilidad pueda incorporarla a Planilla.
      </p>
    </WarehouseForm>
  );
}
