import { confirmDiscard, useUnsavedChanges } from "../../lib/unsaved";
import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  GUIDE_UNITS,
  GUIDE_ITEM_DESCRIPTION_LIMIT,
  dispatchSchema,
  formatMaterialDimensions,
  guideUnitForMaterial,
  type DispatchInput,
  type Lead,
  type Material,
} from "@veca/content";
import { Select } from "@veca/ui/src/Select";
import { Modal } from "../../components/Modal";
import { Button, Field, Notice } from "../../components/ui";
import { motiveOptions, transportOptions } from "./shared";
import {
  MaterialDimensionsFields,
  validMaterialDimensions,
  type DraftDimensions,
} from "../warehouse/MaterialDimensionsFields";

type DraftItem = Omit<DispatchInput["items"][number], "dimensions"> & {
  dimensions?: DraftDimensions;
  key: string;
};
type DispatchDraft = Omit<DispatchInput, "items"> & { items: DraftItem[] };

const emptyLine: DispatchInput["items"][number] = {
  code: "",
  description: "",
  quantity: 1,
  unitCode: "NIU",
};

export function newDispatch(
  lead: Pick<Lead, "name" | "address">,
): DispatchInput {
  return {
    startAddress: "",
    startUbigeo: "",
    arrivalAddress: lead.address?.length <= 250 ? lead.address : "",
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
  guideWorkName?: string;
  onClose: () => void;
  onSave: (
    data: DispatchInput,
    submit: boolean,
    unchanged: boolean,
  ) => Promise<{ sendError: string } | void>;
};

export function DispatchForm({
  initial,
  materials,
  guideWorkName,
  onClose,
  onSave,
}: Props) {
  const formId = useId();
  const [draft, setDraft] = useState<DispatchDraft>(() => ({
    ...initial,
    items: initial.items.map((item) => ({ ...item, key: crypto.randomUUID() })),
  }));
  const [savedDraft, setSavedDraft] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  useUnsavedChanges(draft !== savedDraft, busy);
  const patch = <Key extends keyof DispatchDraft>(
    key: Key,
    value: DispatchDraft[Key],
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
  const setLine = (index: number, fields: Partial<DraftItem>) =>
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
      key: crypto.randomUUID(),
      code: material.sku,
      materialId: material.id,
      description: material.name,
      dimensions: material.dimensions,
      unitCode: guideUnitForMaterial[material.unit],
      quantity: 1,
    };
    const blank =
      draft.items.length === 1 &&
      !draft.items[0].description &&
      !draft.items[0].code &&
      !draft.items[0].materialId &&
      !draft.items[0].dimensions &&
      draft.items[0].quantity === emptyLine.quantity &&
      draft.items[0].unitCode === emptyLine.unitCode;
    patch("items", blank ? [item] : [...draft.items, item]);
  }

  function close() {
    if (confirmDiscard(draft !== savedDraft, busy)) onClose();
  }
  const hasDispatchDetails =
    Boolean(draft.transferAt) &&
    draft.items.length > 0 &&
    draft.items.every((item) => item.description.trim() && item.quantity > 0);
  const completeDimensions = draft.items.every((item) =>
    validMaterialDimensions(item.dimensions),
  );

  async function save(submit: boolean) {
    if (busy || !completeDimensions) return;
    setError("");
    if (submit && !hasDispatchDetails) {
      setError(
        "Completa la fecha de salida y los materiales con sus cantidades.",
      );
      return;
    }
    const parsed = dispatchSchema.safeParse({
      ...draft,
      items: draft.items.map(({ key, ...item }) => item),
    });
    if (!parsed.success) {
      setError(
        "Revisa los datos de la guía y las cantidades de los materiales.",
      );
      return;
    }
    setBusy(true);
    try {
      const outcome = await onSave(parsed.data, submit, draft === savedDraft);
      if (outcome) {
        setSavedDraft(draft);
        setSendError(outcome.sendError);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={guideWorkName ? "Borrador de guía" : "Preparar despacho"}
      description={guideWorkName}
      size="wide"
      className={
        guideWorkName
          ? "dispatch-modal accounting-guide-draft"
          : "dispatch-modal"
      }
      busy={busy}
      onClose={close}
      footer={
        <footer className="ve-modal-actions">
          {!guideWorkName && (
            <Button
              variant="ghost"
              type="button"
              disabled={busy || !completeDimensions}
              onClick={() => void save(false)}
            >
              Guardar borrador
            </Button>
          )}
          <Button
            type="submit"
            form={formId}
            disabled={
              busy ||
              !completeDimensions ||
              (!guideWorkName && !hasDispatchDetails)
            }
          >
            {busy
              ? "Guardando…"
              : guideWorkName
                ? "Guardar borrador"
                : sendError && draft === savedDraft
                  ? "Reintentar envío"
                  : "Enviar a Contabilidad"}
          </Button>
        </footer>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void save(!guideWorkName);
        }}
        className="dispatch-stack"
      >
        {sendError && (
          <Notice error>
            Borrador guardado. Falta enviarlo a Contabilidad. {sendError}
          </Notice>
        )}
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
                  description:
                    item.dimensions &&
                    formatMaterialDimensions(item.dimensions),
                }))}
                onChange={addMaterial}
              />
            </div>
          )}
          {draft.items.map((item, index) => (
            <div className="dispatch-item" key={item.key}>
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
                  maxLength={GUIDE_ITEM_DESCRIPTION_LIMIT}
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
              <button
                className="ops-icon-button dispatch-item-remove"
                type="button"
                aria-label={`Quitar material ${index + 1}`}
                onClick={() =>
                  patch(
                    "items",
                    draft.items.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
              {item.materialId ? (
                item.dimensions &&
                item.dimensions.baseMm !== undefined &&
                item.dimensions.heightMm !== undefined && (
                  <p className="hint dispatch-item-dimensions">
                    Medidas ·{" "}
                    {formatMaterialDimensions({
                      baseMm: item.dimensions.baseMm,
                      heightMm: item.dimensions.heightMm,
                    })}
                  </p>
                )
              ) : (
                <details className="dispatch-item-dimensions">
                  <summary>Medidas de la pieza (opcional)</summary>
                  <MaterialDimensionsFields
                    dimensions={item.dimensions}
                    onChange={(dimensions) => setLine(index, { dimensions })}
                  />
                  {!validMaterialDimensions(item.dimensions) && (
                    <p className="hint">
                      Completa ambas medidas o déjalas vacías.
                    </p>
                  )}
                </details>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            type="button"
            disabled={draft.items.length >= 50}
            onClick={() =>
              patch("items", [
                ...draft.items,
                { ...emptyLine, key: crypto.randomUUID() },
              ])
            }
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
