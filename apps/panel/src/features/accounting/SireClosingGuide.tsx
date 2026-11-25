import { useState } from "react";
import { ExternalLink, FileCheck2 } from "lucide-react";
import type { AccountingPeriod, SirePurchasePage } from "@veca/content";
import { Modal } from "../../components/Modal";
import { Button } from "../../components/ui";
import { accountingPath, useAccountingQuery } from "./accounting-shared";
export function SireClosingGuide({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="sire-next-step">
        <div>
          <strong>Presentar el registro de compras del mes</strong>
          <p>
            Primero revisa las compras. El último paso se completa en SUNAT con
            la persona responsable de Contabilidad.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <FileCheck2 size={16} />
          Ver pasos para presentar
        </Button>
      </div>
      {open && <ClosingDialog month={month} close={() => setOpen(false)} />}
    </>
  );
}
function ClosingDialog({ month, close }: { month: string; close: () => void }) {
  const purchases = useAccountingQuery<SirePurchasePage>(
    `${accountingPath}/sire/purchases?month=${month}&state=all`,
  );
  const report = useAccountingQuery<AccountingPeriod>(
    `${accountingPath}/period/${month}`,
  );
  return (
    <Modal
      title={`Presentar compras · ${month}`}
      description="Guardar compras en VECA no presenta el registro de SUNAT. Sigue estos pasos con Contabilidad."
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button variant="ghost" onClick={close}>
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
      <ol className="sire-closing-steps">
        <li>
          <strong>Completa las compras de este mes</strong>
          <p>
            {purchases.loading
              ? "Consultando la bandeja…"
              : purchases.error
                ? "No pudimos comprobar la bandeja. Vuelve a Compras y gastos y actualízala."
                : !purchases.data?.syncedAt
                  ? "Primero actualiza las compras de este mes para comprobar que la bandeja esté completa."
                  : `${purchases.data?.pending || 0} compras por completar · ${purchases.data?.review || 0} comprobantes con datos por revisar.`}
          </p>
          <a
            className="accounting-inline"
            href="#accounting/gastos"
            onClick={close}
          >
            Revisar compras en VECA
          </a>
        </li>
        <li>
          <strong>Revisa los comprobantes con Contabilidad</strong>
          <p>
            {report.loading
              ? "Consultando registros…"
              : report.error
                ? "Consulta los registros guardados en Compras y gastos."
                : `${report.data?.pendingCosts || 0} registros guardados aún requieren revisión.`}{" "}
            Confirma los importes y qué compras corresponden al registro del
            mes.
          </p>
        </li>
        <li>
          <strong>Completa la presentación en SUNAT</strong>
          <p>
            Entra a SOL y abre SIRE → Registro de compras. Selecciona {month},
            revisa la propuesta y sigue los pasos de aceptación y generación del
            registro. La generación definitiva se realiza en el portal de SUNAT.
          </p>
        </li>
        <li>
          <strong>Conserva la constancia de presentación</strong>
          <p>
            Descárgala desde SUNAT al terminar. Consultar o guardar una compra
            en VECA no acredita que el registro haya sido presentado.
          </p>
        </li>
      </ol>
    </Modal>
  );
}
