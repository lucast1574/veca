import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  GUIDE_UNITS,
  guideUnitForMaterial,
  type DispatchInput,
  type Lead,
  type Material,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { motiveOptions, transportOptions } from "./shared";

const emptyLine: DispatchInput["items"][number] = {
  code: "",
  description: "",
  quantity: 1,
  unitCode: "NIU",
};

export function newDispatch(lead: Lead): DispatchInput {
  return {
    startAddress: "",
    startUbigeo: "",
    arrivalAddress: lead.address || "",
    arrivalUbigeo: "",
    transferAt: "",
    motiveCode: "13",
    motiveDescription: "",
    recipientType: "6",
    recipientNumber: "",
    recipientName: lead.name,
    transportMode: "02",
    carrierRuc: "",
    carrierName: "",
    vehiclePlate: "",
    driverDocument: "",
    driverName: "",
    driverLastName: "",
    driverLicense: "",
    weightKg: 0,
    items: [{ ...emptyLine }],
  };
}

type Props = {
  initial: DispatchInput;
  materials: Material[];
  onClose: () => void;
  onSave: (data: DispatchInput, submit: boolean) => Promise<void>;
};

export function DispatchForm({ initial, materials, onClose, onSave }: Props) {
  const formId = useId();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = <Key extends keyof DispatchInput>(
    key: Key,
    value: DispatchInput[Key],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const text = (
    key: keyof DispatchInput,
    label: string,
    max = 250,
    type = "text",
  ) => (
    <Field label={label}>
      <input
        type={type}
        value={String(draft[key])}
        maxLength={max}
        onChange={(event) => patch(key, event.target.value)}
      />
    </Field>
  );
  const setLine = (
    index: number,
    fields: Partial<DispatchInput["items"][number]>,
  ) =>
    patch(
      "items",
      draft.items.map((item, i) =>
        i === index ? { ...item, ...fields } : item,
      ),
    );

  function addMaterial(code: string) {
    const material = materials.find((row) => row.sku === code);
    if (!material) return;
    const item = {
      code: material.sku,
      materialId: material.id,
      description: material.name,
      unitCode: guideUnitForMaterial[material.unit],
      quantity: 1,
    };
    const blank =
      draft.items.length === 1 &&
      !draft.items[0].description &&
      !draft.items[0].code;
    patch("items", blank ? [item] : [...draft.items, item]);
  }

  function close() {
    if (
      !busy &&
      (draft === initial || window.confirm("¿Cerrar sin guardar el despacho?"))
    )
      onClose();
  }

  async function save(submit: boolean) {
    if (busy) return;
    setError("");
    if (
      submit &&
      (!draft.transferAt ||
        !draft.items.length ||
        draft.items.some(
          (item) => !item.description.trim() || item.quantity <= 0,
        ))
    ) {
      setError(
        "Completa la fecha de salida y los materiales con sus cantidades.",
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(draft, submit);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Preparar despacho"
      size="wide"
      className="dispatch-modal"
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Guardar borrador
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Guardando…" : "Enviar a Contabilidad"}
          </Button>
        </footer>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void save(true);
        }}
        className="dispatch-stack"
      >
        {error && <Notice error>{error}</Notice>}
        <fieldset disabled={busy} className="dispatch-fields">
          <legend>Traslado</legend>
          <div className="dispatch-grid">
            {text("startAddress", "Dirección de origen")}
            {text("arrivalAddress", "Dirección de destino")}
            {text("startUbigeo", "Ubigeo de origen", 6)}
            {text("arrivalUbigeo", "Ubigeo de destino", 6)}
            {text(
              "transferAt",
              "Salida prevista (hora de Lima)",
              30,
              "datetime-local",
            )}
            <Field label="Peso bruto (kg)">
              <input
                type="number"
                min="0"
                step="any"
                value={draft.weightKg || ""}
                onChange={(event) =>
                  patch("weightKg", Number(event.target.value))
                }
              />
            </Field>
            <Field label="Motivo del traslado" htmlFor={formId + "-motive"}>
              <Select
                id={formId + "-motive"}
                label="Motivo del traslado"
                value={draft.motiveCode}
                options={motiveOptions}
                onChange={(value) =>
                  patch("motiveCode", value as DispatchInput["motiveCode"])
                }
              />
            </Field>
            {draft.motiveCode === "13" &&
              text("motiveDescription", "Detalle del motivo", 100)}
          </div>
        </fieldset>
        <fieldset disabled={busy} className="dispatch-fields">
          <legend>Materiales</legend>
          {materials.length > 0 && draft.items.length < 50 && (
            <div className="dispatch-catalog-field">
              <Select
                label="Añadir desde inventario"
                value=""
                placeholder="Añadir desde inventario"
                options={materials.map((item) => ({
                  value: item.sku,
                  label: `${item.sku} · ${item.name}`,
                }))}
                onChange={addMaterial}
              />
            </div>
          )}
          {draft.items.map((item, index) => (
            <div className="dispatch-item" key={index}>
              <Field label="Código">
                <input
                  maxLength={60}
                  value={item.code}
                  readOnly={Boolean(item.materialId)}
                  onChange={(e) => setLine(index, { code: e.target.value })}
                />
              </Field>
              <Field label="Descripción">
                <input
                  maxLength={250}
                  value={item.description}
                  onChange={(e) =>
                    setLine(index, { description: e.target.value })
                  }
                />
              </Field>
              <Field label="Cantidad">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity || ""}
                  onChange={(e) =>
                    setLine(index, { quantity: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Unidad" htmlFor={`${formId}-unit-${index}`}>
                <Select
                  id={`${formId}-unit-${index}`}
                  label="Unidad"
                  value={item.unitCode}
                  disabled={Boolean(item.materialId)}
                  options={GUIDE_UNITS.map((unit) => ({
                    value: unit.id,
                    label: unit.name,
                  }))}
                  onChange={(value) =>
                    setLine(index, { unitCode: value as typeof item.unitCode })
                  }
                />
              </Field>
              <Button
                variant="ghost"
                type="button"
                aria-label={`Quitar material ${index + 1}`}
                onClick={() =>
                  patch(
                    "items",
                    draft.items.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            type="button"
            disabled={draft.items.length >= 50}
            onClick={() => patch("items", [...draft.items, { ...emptyLine }])}
          >
            <Plus size={16} /> Agregar material
          </Button>
        </fieldset>
        <details open>
          <summary>Destinatario y transporte</summary>
          <fieldset disabled={busy} className="dispatch-fields dispatch-grid">
            {text("recipientName", "Nombre o razón social", 150)}
            <div className="dispatch-grid">
              <Field
                label="Documento del destinatario"
                htmlFor={formId + "-recipient"}
              >
                <Select
                  id={formId + "-recipient"}
                  label="Documento del destinatario"
                  value={draft.recipientType}
                  options={[
                    { value: "6", label: "RUC" },
                    { value: "1", label: "DNI" },
                  ]}
                  onChange={(value) =>
                    patch(
                      "recipientType",
                      value as DispatchInput["recipientType"],
                    )
                  }
                />
              </Field>
              {text("recipientNumber", "Número de documento", 11)}
            </div>
            <Field label="Transporte" htmlFor={formId + "-transport"}>
              <Select
                id={formId + "-transport"}
                label="Transporte"
                value={draft.transportMode}
                options={transportOptions}
                onChange={(value) =>
                  patch(
                    "transportMode",
                    value as DispatchInput["transportMode"],
                  )
                }
              />
            </Field>
            {draft.transportMode === "01" ? (
              <>
                {text("carrierRuc", "RUC del transportista", 11)}
                {text("carrierName", "Razón social del transportista", 150)}
              </>
            ) : (
              <>
                {text("vehiclePlate", "Placa", 12)}
                {text("driverDocument", "DNI del conductor", 8)}
                {text("driverName", "Nombres del conductor", 100)}
                {text("driverLastName", "Apellidos del conductor", 100)}
                {text("driverLicense", "Licencia de conducir", 12)}
              </>
            )}
          </fieldset>
        </details>
      </form>
    </Modal>
  );
}
