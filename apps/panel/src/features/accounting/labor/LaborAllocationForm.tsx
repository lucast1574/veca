import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  laborAllocationInput,
  splitLaborCost,
  type AccountingWork,
  type LaborAllocation,
  type LaborSource,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Button, Field } from "../../../components/ui";
import {
  accountingPath,
  amount,
  decimal,
  QueryState,
  useAccountingQuery,
} from "../accounting-shared";
import { LaborForm, saveLabor, validate } from "./labor-shared";

export type AllocationTarget = {
  source: LaborSource;
  revision: number;
  name: string;
  cost: number;
};

export function LaborAllocationForm({
  target,
  current,
  close,
  saved,
}: {
  target: AllocationTarget;
  current?: LaborAllocation;
  close: () => void;
  saved: (message: string) => void;
}) {
  const works = useAccountingQuery<AccountingWork[]>(accountingPath + "/works");
  const [rows, setRows] = useState(() =>
    (current?.rows || []).map((row) => ({
      ...row,
      percent: String(row.basisPoints / 100),
    })),
  );
  const [workId, setWorkId] = useState("");
  const options = (works.data || []).filter(
    (work) => !rows.some((row) => row.workId === work.id),
  );
  const distribution = rows.map(({ workId, percent }) => ({
    workId,
    basisPoints: decimal(percent),
  }));
  const total = distribution.reduce((sum, row) => sum + row.basisPoints, 0);
  const valid =
    total <= 10_000 && distribution.every((row) => row.basisPoints > 0);
  const preview = valid
    ? new Map(
        splitLaborCost(target.cost, distribution).map((row) => [
          row.workId,
          row.cents,
        ]),
      )
    : new Map<string, number>();
  const unassigned =
    target.cost - [...preview.values()].reduce((sum, cents) => sum + cents, 0);
  return (
    <LaborForm
      title="Repartir costo entre obras"
      description={target.name + " · " + amount(target.cost)}
      label="Guardar reparto"
      onClose={close}
      onSaved={() => saved("Reparto guardado.")}
      onSave={() =>
        saveLabor(
          "/allocation",
          validate(laborAllocationInput, {
            source: target.source,
            sourceRevision: target.revision,
            revision: current?.revision ?? 0,
            rows: distribution,
          }),
          "PUT",
        )
      }
    >
      {(changed) => (
        <>
          <p className="hint">
            Indica el porcentaje que corresponde a cada obra. El resto queda
            como costo general del periodo.
          </p>
          <QueryState {...works} empty="No hay obras disponibles.">
            {works.data && works.data.length > 0 && (
              <div className="labor-add">
                <Select
                  label="Obra para agregar"
                  placeholder="Selecciona una obra"
                  value={workId}
                  options={options.map((work) => ({
                    value: work.id,
                    label: work.name,
                  }))}
                  onChange={setWorkId}
                  disabled={!options.length}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!workId || rows.length >= 30}
                  onClick={() => {
                    setRows([
                      ...rows,
                      {
                        workId,
                        percent: Number.isFinite(total)
                          ? String(Math.max(0, 10_000 - total) / 100)
                          : "",
                        basisPoints: 0,
                      },
                    ]);
                    setWorkId("");
                    changed();
                  }}
                >
                  <Plus size={16} /> Agregar
                </Button>
              </div>
            )}
          </QueryState>
          {rows.map((row) => {
            const name =
              works.data?.find((work) => work.id === row.workId)?.name ||
              "Obra vinculada";
            return (
              <div className="labor-allocation-row" key={row.workId}>
                <div>
                  <strong>{name}</strong>
                  <small>
                    {preview.has(row.workId)
                      ? amount(preview.get(row.workId)!)
                      : "—"}
                  </small>
                </div>
                <Field label="Porcentaje">
                  <input
                    aria-label={"Porcentaje de " + name}
                    value={row.percent}
                    onChange={(event) =>
                      setRows(
                        rows.map((item) =>
                          item.workId === row.workId
                            ? { ...item, percent: event.target.value }
                            : item,
                        ),
                      )
                    }
                    inputMode="decimal"
                    pattern="[0-9]+([.,][0-9]{1,2})?"
                    required
                  />
                </Field>
                <button
                  className="ops-icon-button"
                  type="button"
                  aria-label={"Quitar " + name}
                  onClick={() => {
                    setRows(rows.filter((item) => item.workId !== row.workId));
                    changed();
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            );
          })}
          {valid ? (
            <p className="labor-allocation-footer">
              {total / 100} % asignado{" "}
              <strong>{amount(unassigned)} sin asignar</strong>
            </p>
          ) : (
            <p className="hint">
              Usa porcentajes mayores que cero y un total de hasta 100 %.
            </p>
          )}
        </>
      )}
    </LaborForm>
  );
}
