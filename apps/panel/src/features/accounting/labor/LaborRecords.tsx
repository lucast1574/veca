import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  payrollLineCost,
  type LaborAllocation,
  type LaborEmployee,
  type LaborReceipt,
  type LaborSource,
  type PayrollRun,
  type WorkPayrollIncident,
} from "@veca/content";
import { Modal } from "../../../components/Modal";
import { Button, Notice } from "../../../components/ui";
import { amount, displayDate } from "../accounting-shared";
import type { AllocationTarget } from "./LaborAllocationForm";
import "../accounting-records.css";
import "./employees.css";

export type Dialog =
  | { kind: "employee"; record?: LaborEmployee }
  | { kind: "account"; record: LaborEmployee }
  | { kind: "deductionApproval"; record: WorkPayrollIncident }
  | { kind: "payroll"; record?: PayrollRun }
  | { kind: "fee"; record?: LaborReceipt }
  | { kind: "payment"; record: PayrollRun | LaborReceipt }
  | {
      kind: "state";
      record: PayrollRun | LaborReceipt;
      status: "approved" | "void";
    }
  | { kind: "allocation"; target: AllocationTarget };

const statusLabels = {
  draft: "Borrador",
  approved: "Aprobada",
  paid: "Pagada",
  void: "Anulado",
  registered: "Registrado",
};
export const payrollEffective = (run: PayrollRun) =>
  run.status === "approved" || run.status === "paid";
const receiptLabel = (receipt: LaborReceipt) =>
  receipt.series && receipt.number
    ? receipt.series + "-" + receipt.number
    : "Sin número de recibo";

export function Metrics({ entries }: { entries: [string, number][] }) {
  return (
    <dl className="labor-metrics">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{amount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

type RecordActions = {
  open: (dialog: Dialog) => void;
  allocation: (source: LaborSource) => LaborAllocation | undefined;
  canWrite: boolean;
};

export function laborPeriod(period: string) {
  return new Intl.DateTimeFormat("es-PE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(period + "-01T12:00:00Z"));
}

export const payrollStatus = (run: PayrollRun) =>
  run.status === "void" ? "Anulada" : statusLabels[run.status];

export const receiptStatus = (receipt: LaborReceipt) =>
  receipt.status === "registered"
    ? receipt.balanceGrossCents > 0
      ? "Por pagar"
      : "Pagado"
    : statusLabels[receipt.status];

export function LaborStatus({
  state,
  children,
}: {
  state: string;
  children: ReactNode;
}) {
  return (
    <span className="accounting-record-status labor-status" data-state={state}>
      {children}
    </span>
  );
}

export function LaborRow({
  title,
  subtitle,
  total,
  state,
  status,
  onOpen,
}: {
  title: string;
  subtitle: string;
  total: number;
  state: string;
  status: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <div className="accounting-record-label">
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>
      <div className="accounting-record-meta">
        <div className="accounting-record-amount invoice-row-amount">
          <strong>{amount(total)}</strong>
        </div>
        <LaborStatus state={state}>{status}</LaborStatus>
      </div>
      <Button
        variant="ghost"
        aria-label={`Ver detalle de ${title}`}
        onClick={onOpen}
      >
        Ver detalle <ChevronRight size={14} aria-hidden="true" />
      </Button>
    </li>
  );
}

export function PayrollRecords({
  runs,
  emptyWorkers,
  showEmployees,
  pendingDiscounts,
  reviewDiscounts,
  ...actions
}: RecordActions & {
  runs: PayrollRun[];
  emptyWorkers: boolean;
  showEmployees: () => void;
  pendingDiscounts: WorkPayrollIncident[];
  reviewDiscounts: () => void;
}) {
  if (!runs.length)
    return (
      <div className="labor-empty">
        <p>Todavía no hay planilla para este periodo.</p>
        {emptyWorkers && (
          <Button variant="ghost" onClick={showEmployees}>
            Registrar trabajadores
          </Button>
        )}
      </div>
    );
  return runs.map((run) => {
    const hasPendingDiscounts =
      Boolean(run.deductionPending) ||
      pendingDiscounts.some(
        (incident) =>
          incident.period === run.period &&
          run.lines.some((line) => line.employeeId === incident.employeeId),
      );
    const table = (
      <PayrollRunTable
        {...actions}
        run={run}
        hasPendingDiscounts={hasPendingDiscounts}
        reviewDiscounts={reviewDiscounts}
      />
    );
    return run.status === "void" ? (
      <details className="labor-void-run" key={run.id}>
        <summary>
          Planilla anulada · {laborPeriod(run.period)}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        {table}
      </details>
    ) : (
      <section
        className="labor-run"
        key={run.id}
        aria-label={`Planilla de ${laborPeriod(run.period)}`}
      >
        {table}
      </section>
    );
  });
}

function PayrollRunTable({
  run,
  allocation,
  canWrite,
  open,
  hasPendingDiscounts,
  reviewDiscounts,
}: RecordActions & {
  run: PayrollRun;
  hasPendingDiscounts: boolean;
  reviewDiscounts: () => void;
}) {
  const tableId = useId();
  const [expanded, setExpanded] = useState("");
  const actions = (
    <>
      {(run.status === "draft" || run.status === "approved") && (
        <Button
          variant="ghost"
          disabled={!canWrite}
          onClick={() => open({ kind: "state", status: "void", record: run })}
        >
          Anular planilla
        </Button>
      )}
      {run.status === "draft" && (
        <>
          <Button
            variant="ghost"
            disabled={!canWrite}
            onClick={() => open({ kind: "payroll", record: run })}
          >
            Editar borrador
          </Button>
          {hasPendingDiscounts ? (
            <Button onClick={reviewDiscounts}>Revisar descuentos</Button>
          ) : (
            <Button
              disabled={!canWrite}
              onClick={() =>
                open({ kind: "state", status: "approved", record: run })
              }
            >
              Aprobar planilla
            </Button>
          )}
        </>
      )}
      {run.status === "approved" && (
        <Button
          disabled={!canWrite}
          onClick={() => open({ kind: "payment", record: run })}
        >
          Registrar pago
        </Button>
      )}
    </>
  );
  return (
    <div className="labor-run-content">
      <header className="labor-toolbar">
        <div className="labor-run-label">
          <strong>{laborPeriod(run.period)}</strong>
          <LaborStatus state={run.status}>{payrollStatus(run)}</LaborStatus>
        </div>
        <div className="labor-run-actions">{actions}</div>
      </header>
      {run.status === "draft" && hasPendingDiscounts && (
        <p className="notice labor-notice-pending" role="status">
          Revisa los descuentos pendientes antes de aprobar la planilla.
        </p>
      )}
      <Metrics
        entries={[
          [
            run.status === "paid" ? "Neto pagado" : "Neto a pagar",
            run.netCents,
          ],
          ["Sueldo bruto", run.grossCents],
          ["Descuentos", run.deductionCents],
          ["Aporte del empleador", run.employerEssaludCents],
        ]}
      />
      {run.paidAt && (
        <p className="hint">
          Pago registrado el {displayDate(run.paidAt)} · {run.paymentReference}
        </p>
      )}
      <div className="employee-grid-table payroll-table">
        <table aria-label="Trabajadores en la planilla">
          <thead>
            <tr>
              <th scope="col">Trabajador</th>
              <th scope="col">Neto</th>
              <th scope="col" className="payroll-table-wide">
                Costo del trabajador
              </th>
              <th scope="col" className="payroll-table-wide">
                Acciones
              </th>
            </tr>
          </thead>
          {run.lines.map((line) => {
            const source: LaborSource = {
              kind: "payroll",
              id: run.id,
              employeeId: line.employeeId,
            };
            const cost = payrollLineCost(line);
            const openLine = expanded === line.employeeId;
            const breakdownId = tableId + "-" + line.employeeId;
            const lineActions = (
              <div className="payroll-table-actions">
                <Button
                  variant="ghost"
                  aria-expanded={openLine}
                  aria-controls={breakdownId}
                  onClick={() => setExpanded(openLine ? "" : line.employeeId)}
                >
                  {openLine ? "Ocultar desglose" : "Ver desglose"}
                </Button>
                {payrollEffective(run) && (
                  <AllocationButton
                    target={{
                      source,
                      name: line.employeeName,
                      cost,
                      revision: run.revision,
                    }}
                    allocation={allocation}
                    canWrite={canWrite}
                    open={open}
                  />
                )}
              </div>
            );
            return (
              <tbody key={line.employeeId}>
                <tr>
                  <th scope="row">
                    <div className="employee-grid-person">
                      <strong>{line.employeeName}</strong>
                      <small>
                        {line.days} {line.days === 1 ? "día" : "días"}
                      </small>
                      <div className="payroll-table-mobile">{lineActions}</div>
                    </div>
                  </th>
                  <td className="employee-grid-salary">
                    {amount(line.netCents)}
                    <small className="payroll-table-mobile">
                      Costo {amount(cost)}
                    </small>
                  </td>
                  <td className="payroll-table-wide employee-grid-salary">
                    {amount(cost)}
                  </td>
                  <td className="payroll-table-wide">{lineActions}</td>
                </tr>
                <tr
                  id={breakdownId}
                  hidden={!openLine}
                  className="payroll-table-breakdown"
                >
                  {openLine && (
                    <td colSpan={4}>
                      <strong>Bonos, beneficios y descuentos</strong>
                      <dl className="personnel-breakdown">
                        {[
                          ["Bonos y extras afectos", line.taxableExtraCents],
                          ["Bonos e ingresos no afectos", line.nonTaxableCents],
                          ["Gratificación o aguinaldo", line.gratuityCents],
                          ["CTS", line.ctsCents],
                          ["Vacaciones", line.vacationCents],
                          ["Quinta categoría", line.fifthCategoryCents],
                          ["Otros descuentos", line.otherDeductionCents],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{amount(Number(value))}</dd>
                          </div>
                        ))}
                      </dl>
                      {run.workDeductions
                        ?.filter(
                          (incident) => incident.employeeId === line.employeeId,
                        )
                        .map((incident) => (
                          <p className="hint" key={incident.id}>
                            {incident.workName} · {incident.item} ·{" "}
                            {amount(incident.cents)}
                          </p>
                        ))}
                    </td>
                  )}
                </tr>
              </tbody>
            );
          })}
        </table>
        {!run.lines.length && (
          <p className="employee-grid-empty">
            Esta planilla no tiene trabajadores.
          </p>
        )}
      </div>
    </div>
  );
}

export function ReceiptRecords({
  receipts,
  onOpen,
}: {
  receipts: LaborReceipt[];
  onOpen: (id: string) => void;
}) {
  if (!receipts.length)
    return (
      <p className="accounting-empty">
        Todavía no hay recibos por honorarios para este periodo.
      </p>
    );
  return (
    <ul className="accounting-record-list labor-record-list">
      {receipts.map((receipt) => (
        <LaborRow
          key={receipt.id}
          title={receipt.professionalName}
          subtitle={`${receiptLabel(receipt)} · ${displayDate(receipt.issueDate)}`}
          total={receipt.grossCents}
          state={receiptState(receipt)}
          status={receiptStatus(receipt)}
          onOpen={() => onOpen(receipt.id)}
        />
      ))}
    </ul>
  );
}

const receiptState = (receipt: LaborReceipt) =>
  receipt.status === "registered"
    ? receipt.balanceGrossCents > 0
      ? "pending"
      : "paid"
    : receipt.status;

export function ReceiptDetail({
  receipt,
  allocation,
  canWrite,
  open,
  close,
  feedback,
}: RecordActions & {
  receipt: LaborReceipt;
  close: () => void;
  feedback: string;
}) {
  const source: LaborSource = { kind: "fee", id: receipt.id };
  const registered = receipt.status === "registered";
  const actions = (
    <>
      {receipt.status !== "void" && !receipt.paidGrossCents && (
        <Button
          variant="ghost"
          disabled={!canWrite}
          onClick={() =>
            open({ kind: "state", status: "void", record: receipt })
          }
        >
          Anular registro
        </Button>
      )}
      {registered && (
        <AllocationButton
          target={{
            source,
            name: receiptLabel(receipt) + " · " + receipt.professionalName,
            cost: receipt.grossCents,
            revision: receipt.revision,
          }}
          allocation={allocation}
          canWrite={canWrite}
          open={open}
        />
      )}
      {receipt.status === "draft" && (
        <Button
          disabled={!canWrite}
          onClick={() => open({ kind: "fee", record: receipt })}
        >
          Editar borrador
        </Button>
      )}
      {registered && receipt.balanceGrossCents > 0 && (
        <Button
          disabled={!canWrite}
          onClick={() => open({ kind: "payment", record: receipt })}
        >
          Registrar pago
        </Button>
      )}
      {receipt.status === "void" && (
        <Button variant="ghost" onClick={close}>
          Cerrar
        </Button>
      )}
    </>
  );
  return (
    <LaborDetail
      title={receipt.professionalName}
      description={`${receiptLabel(receipt)} · ${displayDate(receipt.issueDate)}`}
      close={close}
      state={receiptState(receipt)}
      status={receiptStatus(receipt)}
      actions={actions}
      feedback={feedback}
    >
      <p>{receipt.service}</p>
      {receipt.paymentTerms === "credit" && (
        <p className="hint">Vence el {displayDate(receipt.dueDate)}</p>
      )}
      {receipt.notes && <p className="hint">{receipt.notes}</p>}
      <Metrics
        entries={[
          ["Importe bruto", receipt.grossCents],
          ["Saldo bruto", receipt.balanceGrossCents],
          ["Pagado al profesional", receipt.paidCents],
          ["Retenido al pagar", receipt.withheldPaidCents],
        ]}
      />
      {receipt.payments.length > 0 && (
        <section className="labor-detail-section">
          <h3>Pagos registrados</h3>
          <ul className="labor-lines" aria-label="Pagos registrados">
            {receipt.payments.map((payment) => (
              <li key={payment.id}>
                <div>
                  <strong>{payment.reference}</strong>
                  <small>{displayDate(payment.date)}</small>
                </div>
                <div>
                  <strong>{amount(payment.amountCents)}</strong>
                  <small>Retención {amount(payment.withholdingCents)}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </LaborDetail>
  );
}

export function LaborDetail({
  title,
  description,
  close,
  state,
  status,
  actions,
  feedback,
  children,
}: {
  title: string;
  description?: string;
  close: () => void;
  state: string;
  status: string;
  actions: ReactNode;
  feedback: string;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={close}
      className="labor-modal"
      footer={
        <footer className="ve-modal-actions labor-detail-actions">
          {actions}
        </footer>
      }
    >
      <div className="labor-detail">
        <LaborStatus state={state}>{status}</LaborStatus>
        {feedback && <Notice>{feedback}</Notice>}
        {children}
      </div>
    </Modal>
  );
}

function AllocationButton({
  target,
  allocation,
  canWrite,
  open,
}: RecordActions & { target: AllocationTarget }) {
  const rows = allocation(target.source)?.rows || [];
  const percent = rows.reduce((sum, row) => sum + row.basisPoints, 0) / 100;
  return (
    <Button
      variant="ghost"
      disabled={!canWrite}
      aria-label={"Repartir costo de " + target.name}
      onClick={() => open({ kind: "allocation", target })}
    >
      {percent ? percent + " % asignado" : "Asignar a obras"}
    </Button>
  );
}
