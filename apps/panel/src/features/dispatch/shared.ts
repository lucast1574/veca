import type { Dispatch, DispatchInput } from "@veca/content";

export const guidePath = "/admin/accounting/guides";

export const transportOptions = [
  { value: "02", label: "Vehículo propio" },
  { value: "01", label: "Flete externo" },
];
export const motiveOptions = [
  { value: "01", label: "Venta" },
  { value: "02", label: "Compra" },
  { value: "13", label: "Otro traslado" },
];
export const transportLabel = (value: string) =>
  transportOptions.find((option) => option.value === value)?.label;
export const motiveLabel = (value: string) =>
  motiveOptions.find((option) => option.value === value)?.label;
export function transferLabel(value: string) {
  if (!value) return "Sin fecha";
  const date = new Date(value + ":00-05:00");
  if (!Number.isFinite(date.getTime())) return "Fecha por corregir";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
}

export function dispatchInput(dispatch: Dispatch): DispatchInput {
  const {
    id,
    leadId,
    workName,
    demo,
    version,
    status,
    observation,
    guideNumber,
    canCheckStatus,
    ...data
  } = dispatch;
  return data;
}
