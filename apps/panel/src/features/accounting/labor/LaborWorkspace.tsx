import {
  EmployeeAccountDialog,
  ApprovePayrollDeductionDialog,
} from "./PersonnelDialogs";
import "./personnel.css";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  laborSourceKey,
  payrollLineCost,
  splitLaborCost,
  type LaborSource,
  type LaborWorkspace as Ledger,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field, Notice } from "../../../components/ui";
import {
  QueryState,
  Refresh,
  today,
  useAccountingQuery,
} from "../accounting-shared";
import { EmployeeForm, PayrollForm } from "./PayrollForms";
import {
  HonorariumForm,
  LaborPaymentForm,
  LaborStatusForm,
} from "./HonorariumForms";
import { LaborAllocationForm } from "./LaborAllocationForm";
import {
  Metrics,
  payrollEffective,
  PayrollDetail,
  ReceiptDetail,
  PayrollRecords,
  ReceiptRecords,
  type Dialog,
} from "./LaborRecords";
import {
  DiscountDetail,
  DiscountRecords,
  EmployeeDetail,
  EmployeeRecords,
} from "./PersonnelRecords";
import { useLiveRefresh } from "../../operations/shared";
import { laborPath } from "./labor-shared";
import "./labor.css";

const monthFormatter = new Intl.DateTimeFormat("es-PE", {
  month: "long",
  timeZone: "UTC",
});
const months = Array.from({ length: 12 }, (_, index) => {
  const month = monthFormatter.format(new Date(Date.UTC(2026, index, 1)));
  return {
    value: String(index + 1).padStart(2, "0"),
    label: month[0].toUpperCase() + month.slice(1),
  };
});

const sections = [
  { id: "runs", label: "Planilla" },
  { id: "receipts", label: "Honorarios" },
  { id: "employees", label: "Trabajadores" },
  { id: "incidents", label: "Descuentos al personal" },
] as const;
type Section = (typeof sections)[number]["id"];
export function LaborWorkspace({
  initialPeriod,
  initialDiscounts = false,
}: { initialPeriod?: string; initialDiscounts?: boolean } = {}) {
  const [section, setSection] = useState<Section>(
    initialDiscounts ? "incidents" : "runs",
  );
  const [period, setPeriod] = useState(initialPeriod || today().slice(0, 7));
  const [year, month] = period.split("-");
  const latestYear = Math.max(Number(today().slice(0, 4)) + 1, Number(year));
  const years = Array.from({ length: latestYear - 1999 }, (_, index) => {
    const value = String(latestYear - index);
    return { value, label: value };
  });
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<Dialog>();
  const [feedback, setFeedback] = useState("");
  const query = useAccountingQuery<Ledger>(laborPath + "?period=" + period);
  useLiveRefresh(query.refresh, false, true, "/account/notifications/events");
  const data = query.data;
  const pendingDiscounts = (data?.incidents || []).filter(
    (incident) =>
      !incident.payrollRunId &&
      (incident.status === "authorized" || incident.status === "approved"),
  );
  const pendingCount = pendingDiscounts.length;
  const allocations = new Map(
    data?.allocations.map((row) => [laborSourceKey(row.source), row]),
  );
  const allocation = (source: LaborSource) =>
    allocations.get(laborSourceKey(source));
  const assigned = (source: LaborSource, cost: number) =>
    splitLaborCost(cost, allocation(source)?.rows || []).reduce(
      (sum, row) => sum + row.cents,
      0,
    );
  let payroll = 0;
  let fees = 0;
  let distributed = 0;
  for (const run of data?.runs.filter(payrollEffective) || []) {
    for (const line of run.lines) {
      const cost = payrollLineCost(line);
      payroll += cost;
      distributed += assigned(
        { kind: "payroll", id: run.id, employeeId: line.employeeId },
        cost,
      );
    }
  }
  for (const receipt of data?.receipts.filter(
    (row) => row.status === "registered",
  ) || []) {
    fees += receipt.grossCents;
    distributed += assigned(
      { kind: "fee", id: receipt.id },
      receipt.grossCents,
    );
  }
  const canWrite = Boolean(data && !query.loading && !query.error);
  const close = () => setDialog(undefined);
  const saved = (message: string) => {
    close();
    setFeedback(message);
    query.refresh();
  };
  const open = (next: Dialog) => {
    setFeedback("");
    setDialog(next);
  };
  const runExists = data?.runs.some((run) => run.status !== "void");
  function changeSection(next: Section) {
    setSelectedId("");
    setFeedback("");
    setSection(next);
  }

  function changePeriod(next: string) {
    setSelectedId("");
    setFeedback("");
    setPeriod(next);
  }

  const closeDetail = () => {
    setSelectedId("");
    setFeedback("");
  };
  const showDetail = (id: string) => {
    setFeedback("");
    setSelectedId(id);
  };
  const detailActions = {
    allocation,
    canWrite,
    open,
    close: closeDetail,
    feedback,
  };
  const selectedRun =
    section === "runs" && data?.runs.find((row) => row.id === selectedId);
  const selectedReceipt =
    section === "receipts" &&
    data?.receipts.find((row) => row.id === selectedId);
  const selectedEmployee =
    section === "employees" &&
    data?.employees.find((row) => row.id === selectedId);
  const selectedDiscount =
    section === "incidents" &&
    data?.incidents?.find((row) => row.id === selectedId);
  const sectionTitle = {
    runs: "Planilla del mes",
    receipts: "Recibos por honorarios",
    employees: "Trabajadores registrados",
    incidents: "Descuentos por incidencias de obra",
  }[section];
  return (
    <section className="labor-workspace" aria-labelledby="labor-title">
      <header className="accounting-section-head">
        <h2 id="labor-title">Planilla y honorarios</h2>
        <Refresh loading={query.loading} onClick={query.refresh} />
      </header>
      <nav className="labor-sections" aria-label="Registros de personal">
        {sections.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={section === id}
            aria-label={
              id === "incidents" && pendingCount
                ? `${label}, ${pendingCount} ${pendingCount === 1 ? "pendiente" : "pendientes"}`
                : label
            }
            onClick={() => changeSection(id)}
          >
            {label}
            {id === "incidents" && pendingCount > 0 && (
              <span className="labor-pending-count" aria-hidden="true">
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>
      {section !== "employees" && (
        <div className="labor-period" role="group" aria-label="Periodo">
          <Field label="Mes">
            <Select
              label="Mes del periodo"
              value={month}
              options={months}
              onChange={(next) => changePeriod(year + "-" + next)}
            />
          </Field>
          <Field label="Año">
            <Select
              label="Año del periodo"
              value={year}
              options={years}
              onChange={(next) => changePeriod(next + "-" + month)}
            />
          </Field>
        </div>
      )}
      {!selectedId && feedback && <Notice>{feedback}</Notice>}
      <QueryState {...query}>
        {data && (
          <section
            className="labor-ledger"
            aria-labelledby="labor-section-title"
          >
            <header className="labor-toolbar">
              <h3 id="labor-section-title">{sectionTitle}</h3>
              {section === "runs" && !runExists && (
                <Button
                  disabled={!canWrite || !data.employees.length}
                  onClick={() => open({ kind: "payroll" })}
                >
                  <Plus size={16} aria-hidden="true" /> Preparar planilla
                </Button>
              )}
              {section === "receipts" && (
                <Button
                  disabled={!canWrite}
                  onClick={() => open({ kind: "fee" })}
                >
                  <Plus size={16} aria-hidden="true" /> Registrar recibo
                </Button>
              )}

              {section === "employees" && (
                <Button
                  disabled={!canWrite}
                  onClick={() => open({ kind: "employee" })}
                >
                  <Plus size={16} aria-hidden="true" /> Registrar trabajador
                </Button>
              )}
            </header>
            {section === "runs" && (
              <PayrollRecords
                runs={data.runs}
                onOpen={showDetail}
                emptyWorkers={!data.employees.length}
                showEmployees={() => changeSection("employees")}
              />
            )}
            {section === "receipts" && (
              <ReceiptRecords receipts={data.receipts} onOpen={showDetail} />
            )}
            {section === "incidents" && (
              <DiscountRecords
                incidents={data.incidents || []}
                onOpen={showDetail}
              />
            )}
            {section === "employees" && (
              <EmployeeRecords employees={data.employees} onOpen={showDetail} />
            )}
          </section>
        )}
      </QueryState>
      {data && (section === "runs" || section === "receipts") && (
        <section
          className="labor-summary"
          aria-labelledby="labor-summary-title"
        >
          <header>
            <h3 id="labor-summary-title">Costos del periodo</h3>
            <a className="accounting-inline" href="#accounting/margen">
              Ver margen por obra
            </a>
          </header>
          <Metrics
            entries={[
              ["Planilla aprobada", payroll],
              ["Honorarios registrados", fees],
              ["Asignado a obras", distributed],
              ["Sin asignar", payroll + fees - distributed],
            ]}
          />
        </section>
      )}
      {selectedRun && (
        <PayrollDetail
          {...detailActions}
          run={selectedRun}
          hasPendingDiscounts={
            Boolean(selectedRun.deductionPending) ||
            pendingDiscounts.some(
              (incident) =>
                incident.period === selectedRun.period &&
                selectedRun.lines.some(
                  (line) => line.employeeId === incident.employeeId,
                ),
            )
          }
          reviewDiscounts={() => changeSection("incidents")}
        />
      )}
      {selectedReceipt && (
        <ReceiptDetail {...detailActions} receipt={selectedReceipt} />
      )}
      {selectedEmployee && (
        <EmployeeDetail
          {...detailActions}
          employee={selectedEmployee}
          regime={
            data?.regimes.find(
              (item) => item.code === selectedEmployee.laborRegime,
            )?.label
          }
        />
      )}
      {data && selectedDiscount && (
        <DiscountDetail
          {...detailActions}
          incident={selectedDiscount}
          runs={data.runs}
        />
      )}
      {data && dialog?.kind === "account" && (
        <EmployeeAccountDialog
          employee={dialog.record}
          close={close}
          done={() =>
            saved(
              "Cuenta vinculada. La persona verá su información en Mi perfil.",
            )
          }
        />
      )}
      {data && dialog?.kind === "deductionApproval" && (
        <ApprovePayrollDeductionDialog
          incident={dialog.record}
          close={close}
          done={(applied) =>
            saved(
              applied
                ? "Descuento aprobado y reflejado en la planilla del trabajador."
                : "Descuento aprobado. Se aplicará automáticamente al preparar la planilla del mes.",
            )
          }
        />
      )}
      {data && dialog?.kind === "employee" && (
        <EmployeeForm
          employee={dialog.record}
          regimes={data.regimes}
          close={close}
          saved={saved}
        />
      )}
      {data && dialog?.kind === "payroll" && (
        <PayrollForm
          run={dialog.record}
          period={period}
          employees={data.employees}
          close={close}
          saved={saved}
        />
      )}
      {dialog?.kind === "fee" && (
        <HonorariumForm
          receipt={dialog.record}
          period={period}
          close={close}
          saved={saved}
        />
      )}
      {dialog?.kind === "payment" && (
        <LaborPaymentForm record={dialog.record} close={close} saved={saved} />
      )}
      {dialog?.kind === "state" && (
        <LaborStatusForm
          record={dialog.record}
          status={dialog.status}
          close={close}
          saved={saved}
        />
      )}
      {dialog?.kind === "allocation" && (
        <LaborAllocationForm
          target={dialog.target}
          current={allocation(dialog.target.source)}
          close={close}
          saved={saved}
        />
      )}
    </section>
  );
}
