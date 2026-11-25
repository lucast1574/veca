import { useRef, useState } from "react";
import type {
  LaborEmployee,
  PayrollRun,
  WorkPayrollIncident,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Field, Notice } from "../../../components/ui";
import { amount, useAccountingQuery } from "../accounting-shared";
import { WarehouseForm } from "../../warehouse/shared";
import { api } from "../../../lib/api";
import { laborPath } from "./labor-shared";
export const incidentState = (i: WorkPayrollIncident) =>
  i.status === "cancelled"
    ? "Cancelado"
    : i.payrollRunId
      ? "Incluido en planilla"
      : i.status === "authorized"
        ? "Listo para incorporar"
        : "Pendiente de sustento";
export function EmployeeAccountDialog({
  employee,
  close,
  done,
}: {
  employee: LaborEmployee;
  close: () => void;
  done: () => void;
}) {
  const query = useAccountingQuery<
    { id: string; name: string; username: string }[]
  >(laborPath + "/accounts");
  const [userId, setUserId] = useState(employee.account?.userId || "");
  return (
    <WarehouseForm
      title="Vincular cuenta VECA"
      action="Guardar vinculación"
      onClose={close}
      hasChanges={userId !== (employee.account?.userId || "")}
      canSubmit={!query.loading && !query.error}
      save={async () => {
        await api(laborPath + `/accounts/${employee.id}`, {
          method: "PUT",
          body: JSON.stringify({
            userId: userId || null,
            revision: employee.account?.revision || 0,
          }),
        });
        done();
      }}
    >
      <div className="warehouse-preview">
        <strong>{employee.name}</strong>
        <p>{employee.position}</p>
      </div>
      <p className="hint">
        Es opcional. La persona elegida podrá consultar únicamente su propia
        remuneración y beneficios en Mi perfil.
      </p>
      {query.error && <Notice error>{query.error}</Notice>}
      <Field label="Cuenta de la plataforma">
        <Select
          floating
          label="Cuenta de la plataforma"
          value={userId}
          onChange={setUserId}
          options={[
            { value: "", label: "Sin cuenta vinculada" },
            ...(query.data || []).map((u) => ({
              value: u.id,
              label: u.name,
              description: u.username,
            })),
          ]}
        />
      </Field>
    </WarehouseForm>
  );
}
export function PayrollDeductionDialog({
  run,
  incidents,
  close,
  done,
}: {
  run: PayrollRun;
  incidents: WorkPayrollIncident[];
  close: () => void;
  done: () => void;
}) {
  const pending = run.deductionPending;
  const [selected, setSelected] = useState(
    pending?.incidentIds || run.workDeductions?.map((i) => i.id) || [],
  );
  const operation = useRef(pending?.operationId || crypto.randomUUID());
  const available = incidents.filter(
    (i) =>
      i.status === "authorized" &&
      i.period === run.period &&
      run.lines.some((l) => l.employeeId === i.employeeId) &&
      (!i.payrollRunId || i.payrollRunId === run.id),
  );
  return (
    <WarehouseForm
      title="Descuentos de obra en planilla"
      action={
        pending ? "Confirmar incorporación" : "Guardar descuentos en borrador"
      }
      onClose={close}
      wide
      hasChanges={
        !pending &&
        [...selected].sort().join() !==
          (run.workDeductions || [])
            .map((i) => i.id)
            .sort()
            .join()
      }
      save={async () => {
        await api(laborPath + `/runs/${run.id}/work-deductions`, {
          method: "POST",
          body: JSON.stringify({
            revision: pending?.revision ?? run.revision,
            operationId: operation.current,
            incidentIds: selected,
          }),
        });
        done();
      }}
    >
      <p className="hint">
        Periodo {run.period}. Solo aparecen incidencias autorizadas para los
        trabajadores incluidos. Se sumarán a Otros descuentos; el sueldo bruto y
        el costo de la obra conservan su cálculo.
      </p>
      {pending && (
        <Notice>
          Hay una incorporación por confirmar. Reintenta esta misma solicitud
          para comprobar el resultado.
        </Notice>
      )}
      {available.length ? (
        <div className="personnel-check-list">
          {available.map((i) => (
            <label key={i.id}>
              <input
                type="checkbox"
                checked={selected.includes(i.id)}
                disabled={!!pending}
                onChange={(e) => {
                  setSelected((v) =>
                    e.target.checked
                      ? [...v, i.id]
                      : v.filter((id) => id !== i.id),
                  );
                  operation.current = crypto.randomUUID();
                }}
              />
              <span>
                <strong>{i.employeeName}</strong>
                <small>
                  {i.workName} · {i.item}
                </small>
                <small>{i.authorization?.reference}</small>
              </span>
              <b>{amount(i.cents)}</b>
            </label>
          ))}
        </div>
      ) : (
        <p className="hint">
          No hay descuentos autorizados para esta planilla.
        </p>
      )}
      <div className="purchase-detail-total">
        <strong>
          Total seleccionado ·{" "}
          {amount(
            available
              .filter((i) => selected.includes(i.id))
              .reduce((s, i) => s + i.cents, 0),
          )}
        </strong>
        <p>
          La planilla debe permanecer en borrador para cambiar esta selección.
        </p>
      </div>
    </WarehouseForm>
  );
}
