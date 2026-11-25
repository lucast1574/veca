import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  SireBook,
  SireComparison,
  SireReconciliation,
} from "@veca/content";
import { purchaseDocumentKey } from "./purchase-document";
import {
  SirePurchasesService,
  type IncomingPurchase,
} from "./sire-purchases.service";
import { SireProvider } from "./sire-provider";
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
  if (!lines.length)
    throw new BadRequestException(
      "La propuesta TXT está vacía. Descarga el archivo con el detalle de comprobantes.",
    );
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
    return [
      {
        doc,
        type: data[6],
        purchase:
          book === "purchases" ? purchaseDetails(data, doc, month) : undefined,
      },
    ];
  });
}

function purchaseDetails(
  data: string[],
  doc: Document,
  period: string,
): IncomingPurchase {
  const money = (index: number) =>
    /^-?\d{1,12}(?:\.\d{1,2})?$/.test(data[index] || "0")
      ? Math.round(Number(data[index] || 0) * 100)
      : NaN;
  const net = [14, 16, 18, 20].reduce((sum, index) => sum + money(index), 0);
  const tax = [15, 17, 19].reduce((sum, index) => sum + money(index), 0);
  const dateMatch = /^(\d{2})\/(\d{2})\/(20\d{2})$/.exec(data[4] || "");
  const date = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : "";
  const validDate =
    date &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  const reason =
    data[6] !== "01"
      ? "Este tipo de comprobante requiere revisión de Contabilidad."
      : doc.currency !== "PEN"
        ? "Este comprobante está en otra moneda. Requiere revisión de Contabilidad."
        : !purchaseDocumentKey(doc.taxId, doc.reference)
          ? "Faltan datos del proveedor o número de factura."
          : !validDate
            ? "Revisa la fecha del comprobante con Contabilidad."
            : !Number.isSafeInteger(net) ||
                !Number.isSafeInteger(tax) ||
                net <= 0 ||
                tax < 0 ||
                net + tax !== doc.total ||
                [21, 22, 23].some((index) => money(index) !== 0)
              ? "El comprobante tiene otros cargos o importes que requieren revisión de Contabilidad."
              : undefined;
  return {
    ...doc,
    period,
    supplier: (data[13] || "").slice(0, 150),
    date,
    type: data[6],
    net: Number.isFinite(net) ? net : 0,
    tax: Number.isFinite(tax) ? tax : 0,
    importable: !reason,
    ...(reason && { reason }),
  };
}

@Injectable()
export class SireService {
  constructor(
    private readonly db: Database,
    private readonly provider: SireProvider,
    private readonly purchases: SirePurchasesService,
  ) {}

  connection() {
    return this.provider.connection();
  }

  async automatic(
    month: string,
    book: SireBook,
    job?: string,
  ): Promise<SireComparison> {
    const proposal = job
      ? await this.provider.poll(job)
      : await this.provider.start(month, book);
    if (
      proposal.period !== month ||
      proposal.book !== book ||
      proposal.ruc !== fiscalIssuerRuc
    )
      throw new BadRequestException(
        "La propuesta no corresponde a la empresa, libro y periodo seleccionados.",
      );
    if (proposal.status === "pending") {
      if (book === "purchases")
        await this.purchases.pending(month, proposal.job);
      return { job: proposal.job, status: "pending" };
    }
    if (
      !proposal.files ||
      proposal.files.reduce(
        (sum, file) => sum + Buffer.byteLength(file.text),
        0,
      ) > 8_000_000
    )
      throw new BadRequestException(
        "No se recibió una propuesta completa de hasta 8 MB.",
      );
    const incoming = proposal.files.flatMap((file) =>
      sunatRows(Buffer.from(file.text), month, book),
    );
    if (incoming.length > 10_000)
      throw new BadRequestException(
        "El periodo supera el límite de 10 000 comprobantes.",
      );
    return {
      job: proposal.job,
      status: "ready",
      result: await this.compare(month, book, incoming),
    };
  }

  async reconcile(
    month: string,
    book: SireBook,
    file?: Express.Multer.File,
  ): Promise<SireReconciliation> {
    if (!file)
      throw new BadRequestException("Adjunta la propuesta TXT de SUNAT.");
    const incoming = sunatRows(file.buffer, month, book);
    if (!incoming.length)
      throw new BadRequestException(
        "La propuesta no contiene comprobantes para comparar.",
      );
    return this.compare(month, book, incoming);
  }

  private async compare(
    month: string,
    book: SireBook,
    incoming: ReturnType<typeof sunatRows>,
  ): Promise<SireReconciliation> {
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
    if (book === "purchases")
      await this.purchases.remember(
        month,
        incoming.flatMap((row) => (row.purchase ? [row.purchase] : [])),
      );
    return { count: incoming.length, matches, issues, book, period: month };
  }
}
