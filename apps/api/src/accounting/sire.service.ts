import { BadRequestException, Injectable } from "@nestjs/common";
import type { SireBook, SireReconciliation } from "@veca/content";
import { fiscalIssuerRuc } from "../common/fiscal-config";
import { Database } from "../database/database.module";

type Issue = SireReconciliation["issues"][number];
type Document = {
  reference: string;
  taxId: string;
  total: number;
  currency: string;
};
const docKey = (doc: Document) => {
  const match = /^([A-Z0-9]{1,20})\s*-\s*(\d{1,20})$/i.exec(doc.reference);
  if (!match || !/^\d{11}$/.test(doc.taxId)) return "";
  return `${doc.taxId}:${match[1].toUpperCase().replace(/^0+(?=.)/, "")}:${match[2].replace(/^0+(?=\d)/, "")}`;
};
const scope = {
  sales: { number: 8, taxId: 11, total: 25, currency: 26 },
  purchases: { number: 9, taxId: 12, total: 24, currency: 25 },
};

function decode(file: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    return new TextDecoder("windows-1252").decode(file);
  }
}

function sunatRows(file: Buffer, month: string, book: SireBook) {
  if (file.includes(0) || file.subarray(0, 2).equals(Buffer.from("PK")))
    throw new BadRequestException(
      "Extrae el ZIP de SUNAT y selecciona el archivo TXT.",
    );
  const text = decode(file);
  const { number, taxId, total, currency } = scope[book];
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 10_000)
    throw new BadRequestException("El archivo supera 10 000 comprobantes.");
  const period = month.replace("-", "");
  let owner = "";
  return lines.flatMap((line, index) => {
    const data = line.split("|").map((value) => value.trim());
    if (index === 0 && /^ruc$/i.test(data[0]) && /periodo/i.test(data[2] || ""))
      return [];
    if (
      data.length <= currency ||
      !/^\d{11}$/.test(data[0]) ||
      data[2] !== period ||
      !/^\d{2}$/.test(data[6]) ||
      !/^[A-Z]{3}$/.test(data[currency]) ||
      !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(data[total])
    )
      throw new BadRequestException(
        `Fila ${index + 1}. Revisa que sea la propuesta de SUNAT del libro y periodo seleccionados.`,
      );
    owner ||= data[0];
    if (owner !== data[0] || (fiscalIssuerRuc && owner !== fiscalIssuerRuc))
      throw new BadRequestException(
        "El archivo no corresponde al mismo contribuyente.",
      );
    const doc: Document = {
      reference: [data[7], data[number]].filter(Boolean).join("-"),
      taxId: data[taxId],
      total: Math.round(Number(data[total]) * 100),
      currency: data[currency],
    };
    return [{ doc, type: data[6] }];
  });
}

@Injectable()
export class SireService {
  constructor(private readonly db: Database) {}

  async reconcile(
    month: string,
    book: SireBook,
    file?: Express.Multer.File,
  ): Promise<SireReconciliation> {
    if (!file)
      throw new BadRequestException("Adjunta la propuesta TXT de SUNAT.");
    const incoming = sunatRows(file.buffer, month, book);
    const range = { $gte: month + "-01", $lte: month + "-31" };
    const rows =
      book === "sales"
        ? await this.db.db
            .collection("accounting_invoices")
            .find({
              issueDate: range,
              status: { $in: ["accepted", "observed"] },
            })
            .project({ number: 1, customerRuc: 1, totalCents: 1 })
            .limit(10001)
            .toArray()
        : await this.db.db
            .collection("accounting_costs")
            .find({ date: range, kind: { $ne: "materials" } })
            .project({ reference: 1, supplierRuc: 1, netCents: 1, taxCents: 1 })
            .limit(10001)
            .toArray();
    if (rows.length > 10000)
      throw new BadRequestException(
        "El periodo supera el límite de 10 000 registros.",
      );
    const local: Document[] = rows.map((row) =>
      book === "sales"
        ? {
            reference: row.number,
            taxId: row.customerRuc,
            total: row.totalCents,
            currency: "PEN",
          }
        : {
            reference: row.reference,
            taxId: row.supplierRuc,
            total: row.netCents + row.taxCents,
            currency: "PEN",
          },
    );
    const issues: Issue[] = [];
    const byKey = new Map<string, Document[]>();
    for (const doc of local) {
      const key = docKey(doc);
      if (!key) {
        issues.push({
          ...doc,
          panel: doc.total,
          status: "manual",
          note: "Falta RUC o serie y número en el panel.",
        });
        continue;
      }
      const group = byKey.get(key) || [];
      group.push(doc);
      byKey.set(key, group);
    }
    let matches = 0;
    const candidates = incoming.filter(({ doc, type }) => {
      if (type === "01" && doc.currency === "PEN" && docKey(doc)) return true;
      issues.push({
        ...doc,
        sunat: doc.total,
        status: "manual",
        note: `Comprobante SUNAT tipo ${type} en ${doc.currency}. Requiere revisión manual.`,
      });
      return false;
    });
    const occurrences = new Map<string, number>();
    for (const { doc } of candidates) {
      const key = docKey(doc);
      occurrences.set(key, (occurrences.get(key) || 0) + 1);
    }
    for (const { doc } of candidates) {
      const key = docKey(doc);
      const group = byKey.get(key) || [];
      if ((occurrences.get(key) || 0) > 1) {
        issues.push({
          ...doc,
          sunat: doc.total,
          status: "manual",
          note: "El comprobante se repite en el archivo de SUNAT.",
        });
        continue;
      }
      byKey.delete(key);
      if (!group.length)
        issues.push({ ...doc, sunat: doc.total, status: "onlySunat" });
      else if (group.length > 1) {
        const panel = group.reduce((sum, entry) => sum + entry.total, 0);
        issues.push({
          ...doc,
          sunat: doc.total,
          panel,
          status: "manual",
          note: "Varios registros del panel comparten este comprobante.",
        });
      } else if (group[0].total !== doc.total)
        issues.push({
          ...doc,
          sunat: doc.total,
          panel: group[0].total,
          status: "different",
        });
      else matches++;
    }
    for (const [key, group] of byKey) {
      if ((occurrences.get(key) || 0) > 1) continue;
      for (const doc of group)
        issues.push({ ...doc, panel: doc.total, status: "onlyPanel" });
    }
    return { count: incoming.length, matches, issues };
  }
}
