import { ChevronDown } from "lucide-react";
import {
  payrollLineCost,
  type LaborAllocation,
  type LaborEmployee,
  type LaborReceipt,
  type LaborSource,
  type PayrollRun,
} from "@veca/content";
import { Button } from "../../../components/ui";
import { amount } from "../accounting-shared";
import type { AllocationTarget } from "./LaborAllocationForm";

export type Dialog =
  | { kind: "employee"; record?: LaborEmployee }
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

export function PayrollRecords({
  runs,
  allocation,
  canWrite,
  open,
  emptyWorkers,
  showEmployees,
}: RecordActions & {
  runs: PayrollRun[];
  emptyWorkers: boolean;
  showEmployees: () => void;
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
  return runs.map((run) => (
    <details
      className="labor-record"
      key={run.id}
      open={run.status !== "void" || undefined}
    >
      <summary>
        <ChevronDown size={17} aria-hidden="true" />
        <strong>Planilla {run.period}</strong>
        <span className="labor-status" data-state={run.status}>
          {run.status === "void" ? "Anulada" : statusLabels[run.status]}
        </span>
        <b>{amount(run.grossCents + run.employerEssaludCents)}</b>
      </summary>
      <div className="labor-record-body">
        <Metrics
          entries={[
            ["Bruto", run.grossCents],
            ["Descuentos", run.deductionCents],
            ["Neto a pagar", run.netCents],
            ["Aporte del empleador", run.employerEssaludCents],
          ]}
        />
        {run.paidAt && (
          <p className="hint">
            Pago registrado el {run.paidAt} · {run.paymentReference}
          </p>
        )}
        <ul className="labor-lines" aria-label="Trabajadores en la planilla">
          {run.lines.map((line) => {
            const source: LaborSource = {
              kind: "payroll",
              id: run.id,
              employeeId: line.employeeId,
            };
            const cost = payrollLineCost(line);
            return (
              <li key={line.employeeId}>
                <div>
                  <strong>{line.employeeName}</strong>
                  <small>
                    {line.days} días · Neto {amount(line.netCents)}
                  </small>
                </div>
                <div>
                  <strong>{amount(cost)}</strong>
                  <small>Costo del trabajador</small>
                </div>
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
              </li>
            );
          })}
        </ul>
        <div className="labor-record-actions">
          {run.status === "draft" && (
            <>
              <Button
                variant="ghost"
                disabled={!canWrite}
                onClick={() => open({ kind: "payroll", record: run })}
              >
                Editar borrador
              </Button>
              <Button
                disabled={!canWrite}
                onClick={() =>
                  open({ kind: "state", status: "approved", record: run })
                }
              >
                Aprobar planilla
              </Button>
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
          {(run.status === "draft" || run.status === "approved") && (
            <Button
              variant="ghost"
              disabled={!canWrite}
              onClick={() =>
                open({ kind: "state", status: "void", record: run })
              }
            >
              Anular planilla
            </Button>
          )}
        </div>
      </div>
    </details>
  ));
}

export function ReceiptRecords({
  receipts,
  allocation,
  canWrite,
  open,
}: RecordActions & { receipts: LaborReceipt[] }) {
  if (!receipts.length)
    return (
      <p className="accounting-empty">
        Todavía no hay recibos por honorarios para este periodo.
      </p>
    );
  return receipts.map((receipt) => {
    const source: LaborSource = { kind: "fee", id: receipt.id };
    const registered = receipt.status === "registered";
    return (
      <details className="labor-record" key={receipt.id}>
        <summary>
          <ChevronDown size={17} aria-hidden="true" />
          <span>
            <strong>{receipt.professionalName}</strong>
            <small>
              {receiptLabel(receipt)} · {receipt.issueDate}
            </small>
          </span>
          <span className="labor-status" data-state={receipt.status}>
            {registered && !receipt.balanceGrossCents
              ? "Pagado"
              : statusLabels[receipt.status]}
          </span>
          <b>{amount(receipt.grossCents)}</b>
        </summary>
        <div className="labor-record-body">
          <p>{receipt.service}</p>
          {receipt.paymentTerms === "credit" && (
            <p className="hint">Vencimiento {receipt.dueDate}</p>
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
            <ul className="labor-lines" aria-label="Pagos registrados">
              {receipt.payments.map((payment) => (
                <li key={payment.id}>
                  <div>
                    <strong>{payment.reference}</strong>
                    <small>{payment.date}</small>
                  </div>
                  <div>
                    <strong>{amount(payment.amountCents)}</strong>
                    <small>Retención {amount(payment.withholdingCents)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="labor-record-actions">
            {receipt.status === "draft" && (
              <Button
                disabled={!canWrite}
                onClick={() => open({ kind: "fee", record: receipt })}
              >
                Editar o registrar
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
            {registered && (
              <AllocationButton
                target={{
                  source,
                  name:
                    receiptLabel(receipt) + " · " + receipt.professionalName,
                  cost: receipt.grossCents,
                  revision: receipt.revision,
                }}
                allocation={allocation}
                canWrite={canWrite}
                open={open}
              />
            )}
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
          </div>
        </div>
      </details>
    );
  });
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
