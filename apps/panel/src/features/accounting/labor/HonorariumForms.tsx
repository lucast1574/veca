import { useState } from "react";
import {
  honorariumInput,
  honorariumPayment,
  payrollTransition,
  type LaborReceipt,
  type PayrollRun,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Field } from "../../../components/ui";
import { amount, today } from "../accounting-shared";
import {
  field,
  LaborForm,
  money,
  MoneyField,
  saveLabor,
  validate,
} from "./labor-shared";

type Actions = { close: () => void; saved: (message: string) => void };
type Withholding = Pick<
  LaborReceipt,
  "withholdingAgent" | "suspensionNumber" | "suspensionYear"
>;

function withholding(form: FormData): Withholding {
  const number = field(form, "suspensionNumber");
  const year = field(form, "suspensionYear");
  if (Boolean(number) !== Boolean(year))
    throw new Error(
      "Completa el número y el año de la constancia de suspensión.",
    );
  return {
    withholdingAgent: form.has("withholdingAgent"),
    suspensionNumber: number,
    suspensionYear: year ? Number(year) : null,
  };
}

function WithholdingFields({ receipt }: { receipt?: Withholding }) {
  return (
    <section
      className="labor-form-card"
      aria-label="Retención de cuarta categoría"
    >
      <label className="labor-check">
        <input
          type="checkbox"
          name="withholdingAgent"
          defaultChecked={receipt?.withholdingAgent ?? true}
        />{" "}
        La empresa es agente de retención
      </label>
      <div className="labor-grid">
        <Field label="Constancia de suspensión (si aplica)">
          <input
            name="suspensionNumber"
            defaultValue={receipt?.suspensionNumber}
            maxLength={100}
          />
        </Field>
        <Field label="Año de la constancia">
          <input
            name="suspensionYear"
            type="number"
            min={2000}
            max={2100}
            defaultValue={receipt?.suspensionYear ?? undefined}
          />
        </Field>
      </div>
    </section>
  );
}

export function HonorariumForm({
  receipt,
  period,
  close,
  saved,
}: Actions & { receipt?: LaborReceipt; period: string }) {
  const [terms, setTerms] = useState(receipt?.paymentTerms || "cash");
  return (
    <LaborForm
      title={
        receipt ? "Editar recibo por honorarios" : "Nuevo recibo por honorarios"
      }
      description="Registra el comprobante emitido por el profesional en SUNAT. Puedes preparar primero un borrador."
      label="Registrar recibo"
      secondary="Guardar borrador"
      onClose={close}
      wide
      onSaved={(action) =>
        saved(
          action === "draft"
            ? "Borrador de honorarios guardado."
            : "Recibo de honorarios registrado.",
        )
      }
      onSave={(form, action) => {
        const registered = action !== "draft";
        const series = field(form, "series").toUpperCase();
        const number = field(form, "number");
        if (
          registered &&
          (!/^E[0-9]{3}$/.test(series) || !/^[1-9][0-9]{0,7}$/.test(number))
        )
          throw new Error(
            "Ingresa la serie electrónica y el número del recibo emitido en SUNAT.",
          );
        const input = validate(honorariumInput, {
          professionalName: field(form, "professional"),
          professionalRuc: field(form, "ruc"),
          service: field(form, "service"),
          grossCents: money(form, "gross"),
          issueDate: field(form, "issue"),
          paymentTerms: terms,
          dueDate: terms === "credit" ? field(form, "due") : "",
          ...withholding(form),
          series,
          number,
          registered,
          notes: field(form, "notes"),
        });
        return receipt
          ? saveLabor(
              "/receipts/" + receipt.id,
              { ...input, revision: receipt.revision },
              "PUT",
            )
          : saveLabor("/receipts", input);
      }}
    >
      {(changed) => (
        <>
          <div className="labor-grid">
            <Field label="Nombre del profesional">
              <input
                name="professional"
                defaultValue={receipt?.professionalName}
                maxLength={180}
                required
              />
            </Field>
            <Field label="RUC del profesional">
              <input
                name="ruc"
                defaultValue={receipt?.professionalRuc}
                inputMode="numeric"
                pattern="10[0-9]{9}"
                maxLength={11}
                required
              />
            </Field>
            <Field label="Serie electrónica">
              <input
                name="series"
                defaultValue={receipt?.series}
                placeholder="E001"
                maxLength={4}
              />
            </Field>
            <Field label="Número de recibo">
              <input
                name="number"
                defaultValue={receipt?.number}
                maxLength={8}
                inputMode="numeric"
              />
            </Field>
            <Field label="Fecha de emisión">
              <input
                name="issue"
                type="date"
                defaultValue={
                  receipt?.issueDate ||
                  (today().startsWith(period) ? today() : period + "-01")
                }
                required
              />
            </Field>
            <MoneyField
              label="Importe bruto (S/)"
              name="gross"
              cents={receipt?.grossCents}
              required
            />
            <Field label="Forma de pago">
              <Select
                label="Forma de pago"
                value={terms}
                options={[
                  { value: "cash", label: "Contado" },
                  { value: "credit", label: "Crédito" },
                ]}
                onChange={(value) => {
                  setTerms(value as typeof terms);
                  changed();
                }}
              />
            </Field>
            {terms === "credit" && (
              <Field label="Fecha de vencimiento">
                <input
                  type="date"
                  name="due"
                  defaultValue={receipt?.dueDate}
                  required
                />
              </Field>
            )}
          </div>
          <Field label="Servicio prestado">
            <textarea
              name="service"
              rows={2}
              maxLength={1000}
              defaultValue={receipt?.service}
              required
            />
          </Field>
          <WithholdingFields receipt={receipt} />
          <Field label="Notas internas">
            <textarea
              name="notes"
              rows={2}
              maxLength={1500}
              defaultValue={receipt?.notes}
            />
          </Field>
        </>
      )}
    </LaborForm>
  );
}

export function LaborPaymentForm({
  record,
  close,
  saved,
}: Actions & { record: PayrollRun | LaborReceipt }) {
  const fee = "professionalRuc" in record;
  return (
    <LaborForm
      title="Registrar pago realizado"
      description={
        fee
          ? "Ingresa el importe bruto abonado, total o parcial. API SUNAT calcula la retención del pago."
          : "Registra la fecha y la referencia del pago de la planilla."
      }
      label="Guardar pago"
      onClose={close}
      onSaved={() => saved("Pago registrado.")}
      onSave={(form) => {
        const input = {
          revision: record.revision,
          date: field(form, "date"),
          reference: field(form, "reference"),
        };
        if (!fee)
          return saveLabor(
            "/runs/" + record.id + "/status",
            validate(payrollTransition, { ...input, status: "paid" }),
          );
        const grossCents = money(form, "gross");
        if (grossCents > record.balanceGrossCents)
          throw new Error("El importe supera el saldo bruto del recibo.");
        return saveLabor(
          "/receipts/" + record.id + "/payments",
          validate(honorariumPayment, {
            ...input,
            grossCents,
            ...withholding(form),
          }),
        );
      }}
    >
      <Field label="Fecha de pago">
        <input
          type="date"
          name="date"
          min={fee ? record.issueDate : record.period + "-01"}
          max={today()}
          defaultValue={today()}
          required
        />
      </Field>
      <Field label="Referencia del pago">
        <input
          name="reference"
          placeholder="Número de operación o constancia"
          maxLength={180}
          required
        />
      </Field>
      {fee && (
        <>
          <p className="hint">
            Saldo bruto pendiente {amount(record.balanceGrossCents)}
          </p>
          <MoneyField
            label="Importe bruto abonado (S/)"
            name="gross"
            cents={record.balanceGrossCents}
            required
          />
          <WithholdingFields receipt={record} />
        </>
      )}
    </LaborForm>
  );
}

export function LaborStatusForm({
  status,
  record,
  close,
  saved,
}: Actions & {
  status: "approved" | "void";
  record: PayrollRun | LaborReceipt;
}) {
  const fee = "professionalRuc" in record;
  const approving = status === "approved";
  const title = approving
    ? "Aprobar planilla"
    : fee
      ? "Anular registro de honorarios"
      : "Anular planilla";
  return (
    <LaborForm
      title={title}
      label={approving ? "Aprobar" : "Confirmar anulación"}
      danger={!approving}
      onClose={close}
      onSaved={() =>
        saved(
          approving
            ? "Planilla aprobada. Ya puedes repartir su costo."
            : "Registro anulado.",
        )
      }
      onSave={() =>
        fee
          ? saveLabor("/receipts/" + record.id + "/void", {
              revision: record.revision,
            })
          : saveLabor("/runs/" + record.id + "/status", {
              status,
              revision: record.revision,
            })
      }
    >
      <p>
        {approving
          ? "La planilla quedará cerrada para edición y podrás asignar su costo a las obras."
          : fee
            ? "El registro dejará de sumar al costo por obra. Si corresponde anular el recibo oficial, el profesional debe gestionarlo en SUNAT."
            : "La planilla dejará de sumar al costo de personal del periodo y al margen de las obras."}
      </p>
    </LaborForm>
  );
}
