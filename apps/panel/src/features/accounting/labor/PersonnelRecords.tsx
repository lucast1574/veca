import type {
  LaborEmployee,
  LaborWorkspace,
  WorkPayrollIncident,
} from "@veca/content";
import { Button } from "../../../components/ui";
import { amount, displayDate } from "../accounting-shared";
import { LaborDetail, LaborRow, type Dialog } from "./LaborRecords";
import { incidentState } from "./PersonnelDialogs";

export function EmployeeRecords({
  employees,
  onOpen,
}: {
  employees: LaborEmployee[];
  onOpen: (id: string) => void;
}) {
  if (!employees.length) {
    return (
      <p className="accounting-empty">
        Registra al primer trabajador para preparar una planilla.
      </p>
    );
  }
  return (
    <ul className="accounting-record-list labor-record-list">
      {employees.map((employee) => (
        <LaborRow
          key={employee.id}
          title={employee.name}
          subtitle={employee.position}
          total={employee.salaryCents}
          state={employee.active ? "approved" : "draft"}
          status={employee.active ? "Activo" : "Inactivo"}
          onOpen={() => onOpen(employee.id)}
        />
      ))}
    </ul>
  );
}

export function DiscountRecords({
  incidents,
  onOpen,
}: {
  incidents: WorkPayrollIncident[];
  onOpen: (id: string) => void;
}) {
  if (!incidents.length) {
    return (
      <p className="accounting-empty">
        No hay descuentos de obra para este periodo.
      </p>
    );
  }
  return (
    <ul className="accounting-record-list labor-record-list">
      {incidents.map((incident) => (
        <LaborRow
          key={incident.id}
          title={incident.employeeName}
          subtitle={`${incident.workName} · ${incident.item}`}
          total={incident.cents}
          state={discountState(incident)}
          status={incidentState(incident)}
          onOpen={() => onOpen(incident.id)}
        />
      ))}
    </ul>
  );
}

function discountState(incident: WorkPayrollIncident) {
  if (incident.status === "cancelled") return "void";
  if (incident.payrollRunId || incident.status === "approved")
    return "approved";
  return "pending";
}

type PersonnelActions = {
  canWrite: boolean;
  open: (dialog: Dialog) => void;
  close: () => void;
  feedback: string;
};

export function EmployeeDetail({
  employee,
  regime,
  canWrite,
  open,
  close,
  feedback,
}: PersonnelActions & { employee: LaborEmployee; regime?: string }) {
  return (
    <LaborDetail
      title={employee.name}
      description={employee.position || undefined}
      state={employee.active ? "approved" : "draft"}
      status={employee.active ? "Activo" : "Inactivo"}
      close={close}
      feedback={feedback}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={!canWrite}
            onClick={() => open({ kind: "account", record: employee })}
          >
            {employee.account?.userId
              ? "Cambiar cuenta VECA"
              : "Vincular cuenta VECA"}
          </Button>
          <Button
            disabled={!canWrite}
            onClick={() => open({ kind: "employee", record: employee })}
          >
            Editar trabajador
          </Button>
        </>
      }
    >
      <dl className="accounting-record-facts">
        <div className="accounting-record-total">
          <dt>Sueldo mensual</dt>
          <dd>{amount(employee.salaryCents)}</dd>
        </div>
        <div>
          <dt>Documento</dt>
          <dd>
            {employee.documentType} {employee.documentNumber}
          </dd>
        </div>
        {regime && (
          <div>
            <dt>Régimen laboral</dt>
            <dd>{regime}</dd>
          </div>
        )}
        <div>
          <dt>Fecha de ingreso</dt>
          <dd>{displayDate(employee.hireDate)}</dd>
        </div>
        <div>
          <dt>Cuenta VECA</dt>
          <dd>
            {employee.account?.userId
              ? employee.account.userName
              : "Sin vincular"}
          </dd>
        </div>
      </dl>
    </LaborDetail>
  );
}

export function DiscountDetail({
  incident,
  runs,
  canWrite,
  open,
  close,
  feedback,
}: PersonnelActions & {
  incident: WorkPayrollIncident;
  runs: LaborWorkspace["runs"];
}) {
  const canRetry =
    incident.status === "approved" &&
    runs.some(
      (run) =>
        run.status === "draft" &&
        run.lines.some((line) => line.employeeId === incident.employeeId),
    );
  const canApprove =
    !incident.payrollRunId && (incident.status === "authorized" || canRetry);
  return (
    <LaborDetail
      title={incident.employeeName}
      description={incident.workName}
      close={close}
      state={discountState(incident)}
      status={incidentState(incident)}
      feedback={feedback}
      actions={
        <>
          <a className="btn btn-ghost" href={`#works/${incident.workId}`}>
            Abrir obra
          </a>
          {canApprove && (
            <Button
              disabled={!canWrite}
              onClick={() =>
                open({ kind: "deductionApproval", record: incident })
              }
            >
              {canRetry ? "Reintentar actualización" : "Aprobar descuento"}
            </Button>
          )}
        </>
      }
    >
      <dl className="accounting-record-facts">
        <div className="accounting-record-total">
          <dt>Importe del descuento</dt>
          <dd>{amount(incident.cents)}</dd>
        </div>
        <div>
          <dt>Fecha de la incidencia</dt>
          <dd>{displayDate(incident.date)}</dd>
        </div>
        <div>
          <dt>Material</dt>
          <dd>{incident.item}</dd>
        </div>
        {incident.quantityNote && (
          <div>
            <dt>Cantidad</dt>
            <dd>{incident.quantityNote}</dd>
          </div>
        )}
      </dl>
      <section className="labor-detail-section">
        <h3>Motivo</h3>
        <p>{incident.reason}</p>
      </section>
      {incident.authorization && (
        <section className="labor-detail-section">
          <h3>Sustento</h3>
          <p>{incident.authorization.reference}</p>
        </section>
      )}
    </LaborDetail>
  );
}
