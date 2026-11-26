import { ArrowRight, Clock3 } from "lucide-react";
export function PurchasePreparation({
  accountingAccess,
  purchaseId,
}: {
  accountingAccess: boolean;
  purchaseId: string;
}) {
  return (
    <section
      className="warehouse-next-step"
      aria-labelledby="purchase-preparation-heading"
    >
      <div className="warehouse-next-step-main">
        <span className="warehouse-step-label">
          <Clock3 size={14} aria-hidden="true" /> Pendiente de Contabilidad
        </span>
        <h3 id="purchase-preparation-heading">Completar datos de la compra</h3>
        <p>
          Contabilidad completará los materiales, cantidades y precios. Después
          podrás confirmar aquí lo que llegó.
        </p>
        {accountingAccess && (
          <a
            className="btn btn-primary"
            href={`#accounting/gastos/${purchaseId}/preparar`}
          >
            Completar en Contabilidad{" "}
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        )}
      </div>
    </section>
  );
}
