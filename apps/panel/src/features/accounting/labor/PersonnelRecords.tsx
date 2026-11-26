import { useState } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronRight,
  Search,
} from "lucide-react";
import { Select } from "@veca/ui/src/Select";
import type {
  LaborEmployee,
  LaborWorkspace,
  WorkPayrollIncident,
} from "@veca/content";
import { Button } from "../../../components/ui";
import { amount, displayDate } from "../accounting-shared";
import {
  LaborDetail,
  LaborRow,
  LaborStatus,
  type Dialog,
} from "./LaborRecords";
import { incidentState } from "./PersonnelDialogs";

const employeeStates = [
  { value: "", label: "Todos los estados" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
];
const employeeCollator = new Intl.Collator("es-PE", { sensitivity: "base" });
const employeeSearch = (value: string) =>
  value.toLocaleLowerCase("es-PE").normalize("NFD").replace(/\p{M}/gu, "");

const employeeSortColumns = [
  { key: "name", label: "Trabajador" },
  { key: "salary", label: "Sueldo mensual" },
] as const;
type EmployeeSortKey = (typeof employeeSortColumns)[number]["key"];

export function EmployeeRecords({
  employees,
  onOpen,
}: {
  employees: LaborEmployee[];
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<{
    key: EmployeeSortKey;
    ascending: boolean;
  }>({
    key: "name",
    ascending: true,
  });

  if (!employees.length) {
    return (
      <p className="accounting-empty">
        Registra al primer trabajador para preparar una planilla.
      </p>
    );
  }

  const term = employeeSearch(search.trim());
  const rows = employees
    .filter(
      (employee) =>
        (!state || employee.active === (state === "active")) &&
        employeeSearch(employee.name + " " + employee.position).includes(term),
    )
    .sort((first, second) => {
      const alphabetical = employeeCollator.compare(first.name, second.name);
      const comparison =
        sort.key === "salary"
          ? first.salaryCents - second.salaryCents || alphabetical
          : alphabetical;
      return sort.ascending ? comparison : -comparison;
    });

  function sortBy(key: EmployeeSortKey) {
    setSort((current) => ({
      key,
      ascending: current.key !== key || !current.ascending,
    }));
  }

  return (
    <div className="employee-grid">
      <div className="employee-grid-tools">
        <label className="search-input">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar trabajadores"
            placeholder="Nombre o cargo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Select
          label="Estado de los trabajadores"
          options={employeeStates}
          value={state}
          onChange={setState}
        />
      </div>
      <div className="employee-grid-table">
        <table aria-label="Trabajadores registrados">
          <thead>
            <tr>
              {employeeSortColumns.map(({ key, label }) => {
                const active = sort.key === key;
                const SortIcon = active
                  ? sort.ascending
                    ? ArrowUp
                    : ArrowDown
                  : ArrowDownUp;
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      active
                        ? sort.ascending
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <button type="button" onClick={() => sortBy(key)}>
                      {label} <SortIcon size={14} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="employee-grid-status">
                Estado
              </th>
              <th scope="col" className="employee-grid-actions">
                Acción
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((employee) => {
              const status = (
                <LaborStatus state={employee.active ? "approved" : "draft"}>
                  {employee.active ? "Activo" : "Inactivo"}
                </LaborStatus>
              );
              const action = (
                <Button
                  variant="ghost"
                  aria-label={`Ver detalle de ${employee.name}`}
                  onClick={() => onOpen(employee.id)}
                >
                  Ver detalle <ChevronRight size={14} aria-hidden="true" />
                </Button>
              );
              return (
                <tr key={employee.id}>
                  <th scope="row">
                    <div className="employee-grid-person">
                      <strong>{employee.name}</strong>
                      {employee.position && <small>{employee.position}</small>}
                      <div className="employee-grid-mobile-status">
                        {status}
                      </div>
                    </div>
                  </th>
                  <td className="employee-grid-salary">
                    {amount(employee.salaryCents)}
                    <div className="employee-grid-mobile-action">{action}</div>
                  </td>
                  <td className="employee-grid-status">{status}</td>
                  <td className="employee-grid-actions">{action}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="employee-grid-empty" role="status">
            No hay trabajadores que coincidan con la búsqueda.
          </p>
        )}
      </div>
    </div>
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
