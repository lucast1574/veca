import { useState } from "react";
import type { LaborEmployee, WorkPayrollIncident } from "@veca/content";
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
      : i.status === "approved"
        ? "Aprobado · Pendiente de planilla"
        : i.status === "authorized"
          ? "Pendiente de aprobación"
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
export function ApprovePayrollDeductionDialog({
  incident,
  close,
  done,
}: {
  incident: WorkPayrollIncident;
  close: () => void;
  done: (applied: boolean) => void;
}) {
  const retry = incident.status === "approved";
  return (
    <WarehouseForm
      title={
        retry
          ? "Actualizar descuento en Planilla"
          : "Aprobar descuento al personal"
      }
      action={retry ? "Reintentar actualización" : "Aprobar descuento"}
      onClose={close}
      save={async () => {
        const result = await api<{ applied: boolean }>(
          laborPath + `/incidents/${incident.id}/approve`,
          {
            method: "POST",
            body: JSON.stringify({ revision: incident.revision }),
          },
        );
        done(result.applied);
      }}
    >
      <div className="warehouse-preview">
        <strong>
          {incident.employeeName} · {amount(incident.cents)}
        </strong>
        <p>
          {incident.workName} · {incident.item}
        </p>
      </div>
      <p>
        Este importe se descontará del sueldo neto del trabajador en la planilla
        de{" "}
        {new Intl.DateTimeFormat("es-PE", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(incident.period + "-01T12:00:00Z"))}
        .
      </p>
      <p className="hint">
        Si ya existe el borrador con este trabajador, se actualizará
        automáticamente. Si aún no existe, el descuento se aplicará al
        prepararlo.
      </p>
      <p className="hint">Sustento: {incident.authorization?.reference}</p>
    </WarehouseForm>
  );
}
