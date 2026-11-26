import { useState } from "react";
import { ExternalLink, FileCheck2 } from "lucide-react";
import type { AccountingPeriod, SireBook } from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/ui";
import { SalesPending } from "./AccountingPeriodPending";
import {
  accountingPath,
  QueryState,
  useAccountingQuery,
} from "./accounting-shared";

export function SireClosingGuide({
  month,
  book = "purchases",
}: {
  month: string;
  book?: SireBook;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="ops-card sire-closing-guide">
        <div className="sire-next-step">
          <div>
            {book === "purchases" ? (
              <strong>Registro mensual de compras en SUNAT</strong>
            ) : (
              <>
                <strong>Presentar el registro de ventas del mes</strong>
                <p>
                  Primero revisa las ventas. El último paso se completa en SUNAT
                  con la persona responsable de Contabilidad.
                </p>
              </>
            )}
          </div>
          <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
            <FileCheck2 size={16} /> Ver pasos para presentar
          </Button>
        </div>
      </section>
      {open && (
        <ClosingDialog month={month} book={book} close={() => setOpen(false)} />
      )}
    </>
  );
}
function ClosingDialog({
  month,
  book,
  close,
}: {
  month: string;
  book: SireBook;
  close: () => void;
}) {
  const report = useAccountingQuery<AccountingPeriod>(
    `${accountingPath}/period/${month}`,
  );
  const purchases = report.data?.sirePurchases;
  const isPurchase = book === "purchases";
  const name = isPurchase ? "compras" : "ventas";
  return (
    <Modal
      title={`Presentar ${name} · ${month}`}
      description={`${isPurchase ? "Guardar compras" : "Emitir facturas"} en VECA no presenta el registro mensual de SUNAT. Sigue estos pasos con Contabilidad.`}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button type="button" variant="ghost" onClick={close}>
            Cerrar
          </Button>
          <a
            className="accounting-inline"
            href="https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
            target="_blank"
            rel="noreferrer"
          >
            Continuar en SUNAT <ExternalLink size={15} />
          </a>
        </footer>
      }
    >
      <QueryState {...report} />
      <ol className="sire-closing-steps">
        <li>
          <strong>
            {isPurchase
              ? "Completa las compras de este mes"
              : "Termina de emitir y confirmar tus facturas"}
          </strong>
          {isPurchase ? (
            <p>
              {report.loading
                ? "Consultando la bandeja…"
                : !purchases?.syncedAt
                  ? "Actualiza las compras de este mes para comprobar que la bandeja esté completa."
                  : `${purchases.pending} compras por completar · ${purchases.review} comprobantes con datos por revisar.`}
            </p>
          ) : (
            report.data && <SalesPending report={report.data} />
          )}
          <a
            className="accounting-inline"
            href={`#accounting/${isPurchase ? "gastos" : "facturas"}?month=${month}`}
            onClick={close}
          >
            {isPurchase
              ? "Revisar compras en VECA"
              : "Revisar facturas en VECA"}
          </a>
        </li>
        <li>
          <strong>Revisa los comprobantes con Contabilidad</strong>
          <p>
            {report.data &&
              !report.error &&
              (isPurchase
                ? `${report.data.pendingCosts} compras guardadas sin sustento. `
                : `${report.data.salesCount} facturas aceptadas en este periodo. `)}
            Confirma los importes y qué {name} corresponden al registro del mes.
          </p>
        </li>
        <li>
          <strong>Completa la presentación en SUNAT</strong>
          <p>
            Entra a SOL y abre SIRE →{" "}
            {isPurchase
              ? "Registro de compras (RCE)"
              : "Registro de ventas e ingresos (RVIE)"}
            . Selecciona {month}, revisa la propuesta y sigue los pasos de
            aceptación y generación del registro. La generación definitiva se
            realiza en el portal de SUNAT.
          </p>
        </li>
        <li>
          <strong>Conserva la constancia de presentación</strong>
          <p>
            Descárgala desde SUNAT al terminar. Consultar o guardar un
            comprobante en VECA no acredita que el registro haya sido
            presentado.
          </p>
        </li>
      </ol>
    </Modal>
  );
}
