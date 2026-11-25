import { ConflictException } from "@nestjs/common";
import type { Db } from "mongodb";

export function purchaseDocumentKey(ruc: string, reference: string) {
  const match = /^([A-Z0-9]{1,20})\s*-\s*(\d{1,20})$/i.exec(reference.trim());
  if (!/^\d{11}$/.test(ruc) || !match) return undefined;
  return `${ruc}:${match[1].toUpperCase().replace(/^0+(?=.)/, "")}:${match[2].replace(/^0+(?=\d)/, "")}`;
}

// Legacy costs do not yet have invoiceKey. Include them in duplicate checks.
export async function matchingPurchaseCosts(
  db: Db,
  ruc: string,
  reference: string,
) {
  const key = purchaseDocumentKey(ruc, reference);
  if (!key) return [];
  const rows = await db
    .collection("accounting_costs")
    .find({ supplierRuc: ruc, kind: { $ne: "materials" } })
    .project({
      reference: 1,
      supplierRuc: 1,
      netCents: 1,
      taxCents: 1,
      purchaseId: 1,
    })
    .limit(10001)
    .toArray();
  if (rows.length > 10000)
    throw new ConflictException(
      "Demasiados comprobantes del proveedor. Solicita una revisión antes de incorporar.",
    );
  return rows.filter(
    (row) => purchaseDocumentKey(row.supplierRuc, row.reference || "") === key,
  );
}
