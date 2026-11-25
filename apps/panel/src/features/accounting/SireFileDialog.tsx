import { useState } from "react";
import type { SireBook, SireReconciliation as Result } from "@veca/content";
import { FileInput } from "../../components/FileInput";
import { api } from "../../lib/api";
import { WarehouseForm, WarehouseSelect } from "../warehouse/shared";
import { useAccountingPermission } from "./AccountingAccess";
import { accountingPath } from "./accounting-shared";

export function SireFileDialog({
  month,
  close,
  done,
  initialBook = "purchases",
  lockBook = false,
}: {
  month: string;
  initialBook?: SireBook;
  lockBook?: boolean;
  close: () => void;
  done: (result: Result) => void;
}) {
  const canWrite = useAccountingPermission("accounting_write");
  const [book, setBook] = useState<SireBook>(initialBook);
  return (
    <WarehouseForm
      title="Comparar archivo de SUNAT"
      action="Comparar comprobantes"
      canSubmit={canWrite}
      onClose={close}
      save={async (values) => {
        const file = values.get("file");
        if (
          !(file instanceof File) ||
          !/\.txt$/i.test(file.name) ||
          !file.size ||
          file.size > 8_000_000
        )
          throw new Error(
            "Adjunta la propuesta TXT de SUNAT, con contenido y de hasta 8 MB.",
          );
        const form = new FormData();
        form.append("file", file);
        const next = await api<Result>(
          `${accountingPath}/period/${month}/reconcile/${book}`,
          {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(30_000),
          },
        );
        done(next);
      }}
    >
      <p className="hint">
        Periodo {month}. Adjunta el TXT original de la propuesta descargada de
        SIRE. Si viene en ZIP, extráelo primero.
      </p>
      {!lockBook && (
        <WarehouseSelect
          label="Registro"
          value={book}
          onChange={(value) => setBook(value as SireBook)}
          options={[
            { value: "purchases", label: "Registro de compras (RCE)" },
            { value: "sales", label: "Registro de ventas (RVIE)" },
          ]}
        />
      )}
      <FileInput
        label="Archivo de la propuesta (TXT)"
        disabled={!canWrite}
        accept=".txt"
        name="file"
        required
      />
      <details className="warehouse-preview import-instructions sire-file-help">
        <summary>Qué archivo necesitas</summary>
        <ol>
          <li>
            Entra a SIRE de SUNAT con la cuenta de la empresa y elige el periodo{" "}
            <strong>{month}</strong>.
          </li>
          <li>
            Descarga la propuesta del{" "}
            {book === "purchases"
              ? "Registro de compras (RCE)"
              : "Registro de ventas e ingresos (RVIE)"}
            .
          </li>
          <li>
            Si llega en ZIP, extráelo y adjunta el <strong>TXT original</strong>
            , separado por barras verticales (|). Conserva sus columnas.
          </li>
        </ol>
        <p className="hint">
          Hasta 8 MB y 10 000 comprobantes. El archivo debe corresponder al
          mismo RUC, periodo y registro. Un PDF, Excel o reporte resumido no
          sirve para esta comparación.
        </p>
        <a
          className="warehouse-link"
          href="https://cpe.sunat.gob.pe/node/158"
          target="_blank"
          rel="noreferrer"
        >
          Ver orientación oficial de SIRE
        </a>
      </details>
      <p className="hint">
        Verás coincidencias, importes distintos y comprobantes que aparecen solo
        en SUNAT o solo en VECA. Las facturas en soles se comparan
        automáticamente; otros tipos, monedas o datos incompletos requieren
        revisión manual. Este paso no declara impuestos ni modifica tus
        registros contables.{" "}
        {book === "purchases"
          ? "Las compras nuevas quedan pendientes en la bandeja de VECA."
          : "Las ventas que aparezcan solo en SUNAT requieren revisión; no se emite otra factura al comparar."}
      </p>
    </WarehouseForm>
  );
}
