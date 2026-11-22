export const DEMO_CASES = [
  {
    key: "mamparas",
    name: "[DEMO] Mamparas San Borja",
    district: "San Borja",
    ubigeo: "150130",
    idea: "Instalación de cuatro mamparas de vidrio templado. La obra se entrega en dos visitas.",
    material: "Vidrio templado de 10 mm",
    sku: "VID-010",
    quantity: 18,
    unitCode: "MTK",
    order: "2 barras de 6 m",
    reason:
      "Faltan 7 m. El proveedor vende barras completas y quedan 5 m antes del corte.",
    equipment: "EQU-007 · Ventosa doble",
    sale: 18500,
    cost: 11900,
    collected: 10000,
    expense: 220,
    charge: "Combustible",
    transport: "02",
    guideStatus: "review",
  },
  {
    key: "fachada",
    name: "[DEMO] Fachada y panelería Surco",
    district: "Santiago de Surco",
    ubigeo: "150140",
    idea: "Instalación de fachada de vidrio y panelería interior con tableros aglomerados de 18 mm.",
    material: "Tablero aglomerado de 18 mm",
    sku: "AGL-018",
    quantity: 5,
    unitCode: "NIU",
    order: "1 paquete de 5 tableros",
    reason:
      "Faltan 4 tableros. Se compra un paquete y 1 tablero queda en almacén.",
    equipment: "EQU-021 · Cortadora",
    sale: 24000,
    cost: 16200,
    collected: 8000,
    expense: 520,
    charge: "Flete externo",
    transport: "01",
    guideStatus: "returned",
  },
] as const;

export type DemoCaseKey = (typeof DEMO_CASES)[number]["key"];
export type DemoLink = {
  key: DemoCaseKey;
  leadId: string;
  dispatchId: string | null;
};

export type DemoInvoice = {
  key: DemoCaseKey;
  number: string | null;
  status: string;
};
