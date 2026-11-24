import { Field } from "../../components/ui";
import { api } from "../../lib/api";
import { WarehouseForm, stringField } from "../warehouse/shared";
export function DiscardGuideDialog({
  path,
  version,
  close,
  done,
}: {
  path: string;
  version: number;
  close: () => void;
  done: () => void;
}) {
  return (
    <WarehouseForm
      title="Descartar preparación de guía"
      action="Descartar preparación"
      onClose={close}
      save={async (form) => {
        await api(path, {
          method: "POST",
          body: JSON.stringify({
            version,
            observation: stringField(form, "reason"),
          }),
        });
        done();
      }}
    >
      <p className="hint">
        Se conservará el historial de esta preparación. Esta acción no anula
        documentos fiscales emitidos.
      </p>
      <Field label="Motivo del descarte">
        <textarea
          name="reason"
          rows={3}
          required
          minLength={3}
          maxLength={500}
        />
      </Field>
    </WarehouseForm>
  );
}
