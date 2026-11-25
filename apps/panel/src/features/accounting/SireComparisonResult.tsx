import { useEffect, useState } from "react";
import type { SireReconciliation } from "@veca/content";
import { Button } from "../../components/ui";
import { amount, Pagination } from "./accounting-shared";

const labels = {
  different: "Importe distinto",
  onlySunat: "Solo en SUNAT",
  onlyPanel: "Solo en VECA",
  manual: "Revisión manual",
};
const exportRows = (result: SireReconciliation) => {
  const escape = (value: string) =>
    '"' +
    (/^\s*[=+@-]/.test(value) ? "'" : "") +
    value.replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      [
        "Estado",
        "Comprobante",
        "RUC",
        "Total SUNAT",
        "Total VECA",
        "Moneda",
        "Detalle",
      ],
      ...result.issues.map((issue) => [
        labels[issue.status],
        issue.reference,
        issue.taxId,
        issue.sunat == null ? "" : (issue.sunat / 100).toFixed(2),
        issue.panel == null ? "" : (issue.panel / 100).toFixed(2),
        issue.currency,
        issue.note || "",
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
};

export function SireComparisonResult({
  result,
}: {
  result: SireReconciliation;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [result]);
  const size = 20;
  const book = result.book === "purchases" ? "compras" : "ventas";
  return (
    <div className="sire-comparison-result">
      <div className="warehouse-preview" role="status">
        <strong>
          {result.matches} coinciden · {result.issues.length} por revisar
        </strong>
        <p>
          {result.count
            ? `${result.count} comprobantes de ${book} encontrados en SUNAT.`
            : `SUNAT no encontró ${book} en este mes.`}
        </p>
      </div>
      {Boolean(result.issues.length) && (
        <>
          <div className="ops-table-wrap">
            <table className="ops-material-table warehouse-plan-table">
              <thead>
                <tr>
                  {["Comprobante", "SUNAT", "VECA", "Resultado"].map(
                    (label) => (
                      <th key={label}>{label}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {result.issues
                  .slice((page - 1) * size, page * size)
                  .map((issue, index) => (
                    <tr key={index}>
                      <td>
                        <strong>{issue.reference || "Sin número"}</strong>
                        <small>{issue.taxId}</small>
                      </td>
                      <td>
                        {issue.sunat == null
                          ? "—"
                          : issue.currency === "PEN"
                            ? amount(issue.sunat)
                            : `${issue.currency} ${(issue.sunat / 100).toFixed(2)}`}
                      </td>
                      <td>{issue.panel == null ? "—" : amount(issue.panel)}</td>
                      <td>
                        <strong>{labels[issue.status]}</strong>
                        {issue.note && <small>{issue.note}</small>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            hasMore={page * size < result.issues.length}
            change={setPage}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([exportRows(result)], {
                  type: "text/csv;charset=utf-8",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `conciliacion-${result.book || "sunat"}-${result.period || "periodo"}.csv`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Descargar diferencias
          </Button>
        </>
      )}
    </div>
  );
}
