import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DEMO_CASES, type DemoCaseKey, type DemoInvoice } from "@veca/content";
import { z } from "zod";
import { config } from "../common/config";
import { Database } from "../database/database.module";
import { limaDate } from "./guide-provider";

type DemoInvoiceRecord = {
  _id: DemoCaseKey;
  issueDate: string;
  id?: string;
  number?: string | null;
  status?: string;
};

const base = "https://api.apisunat.net/api/v1/issuer";
const failure = () =>
  new ServiceUnavailableException(
    "No pudimos confirmar los comprobantes en el entorno de prueba.",
  );

const issuerList = z.object({
  data: z.array(
    z.object({
      ruc: z.string().regex(/^\d{11}$/),
      livemode: z.boolean(),
      active: z.boolean(),
      isDefault: z.boolean(),
    }),
  ),
});
const demoDocument = z.object({
  id: z.uuid(),
  type: z.literal("01"),
  test: z.literal(true),
  issuerRuc: z.string(),
  status: z.string(),
  fullNumber: z.string().nullable().optional(),
});

@Injectable()
export class DemoInvoiceService {
  constructor(private readonly database: Database) {}

  async list(): Promise<DemoInvoice[]> {
    const rows = await this.collection
      .find({ id: { $exists: true } })
      .toArray();
    return rows.map((row) => ({
      key: row._id,
      number: row.number ?? null,
      status: row.status || "processing",
    }));
  }

  async generate() {
    const key = this.key();
    const result = issuerList.safeParse(await this.request("/issuers", key));
    if (!result.success) throw failure();
    const issuers = result.data.data.filter(
      (item) => !item.livemode && item.active,
    );
    const configuredRuc = config.APISUNAT_TEST_ISSUER_RUC;
    const issuer = configuredRuc
      ? issuers.find((item) => item.ruc === configuredRuc)
      : (issuers.find((item) => item.isDefault === true) ??
        (issuers.length === 1 ? issuers[0] : undefined));
    if (!issuer)
      throw new ServiceUnavailableException(
        "El espacio de prueba necesita un emisor beta configurado.",
      );
    await Promise.all(
      DEMO_CASES.map((example) => this.generateOne(example, key, issuer.ruc)),
    );
    return this.list();
  }

  async pdf(caseKey: string) {
    const example = DEMO_CASES.find((item) => item.key === caseKey);
    if (!example)
      throw new NotFoundException("Factura de demostración no encontrada.");
    const invoice = await this.collection.findOne({ _id: example.key });
    if (!invoice?.id)
      throw new NotFoundException(
        "La factura de prueba aún no está disponible.",
      );
    try {
      const response = await this.fetch(
        `/documents/${encodeURIComponent(invoice.id)}/pdf`,
        this.key(),
      );
      if (
        response.headers.get("content-type")?.split(";")[0] !==
        "application/pdf"
      )
        throw failure();
      const pdf = Buffer.from(await response.arrayBuffer());
      if (pdf.subarray(0, 5).toString() !== "%PDF-") throw failure();
      return pdf;
    } catch {
      throw failure();
    }
  }

  private get collection() {
    return this.database.db.collection<DemoInvoiceRecord>("demo_invoices");
  }

  private key() {
    const key = config.APISUNAT_TEST_API_KEY || config.APISUNAT_API_KEY;
    if (!key.startsWith("asu_test_"))
      throw new ServiceUnavailableException(
        "La credencial de prueba todavía no está configurada en el servidor.",
      );
    return key;
  }

  private async generateOne(
    example: (typeof DEMO_CASES)[number],
    key: string,
    ruc: string,
  ) {
    const record = await this.collection.findOneAndUpdate(
      { _id: example.key },
      { $setOnInsert: { issueDate: limaDate() } },
      { upsert: true, returnDocument: "after" },
    );
    if (!record) throw failure();
    if (
      !record.id &&
      record.issueDate < limaDate(new Date(Date.now() - 5 * 86_400_000))
    )
      throw new ServiceUnavailableException(
        "Hay un intento de prueba sin confirmar. Revisa el historial beta antes de continuar.",
      );
    const response = record.id
      ? await this.request(`/documents/${encodeURIComponent(record.id)}`, key)
      : await this.request("/documents", key, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `veca-demo-invoice-v1-${example.key}-${ruc}`,
          },
          body: JSON.stringify({
            ruc,
            documentType: "01",
            currency: "PEN",
            issueDate: record.issueDate,
            customer: {
              documentType: "6",
              documentNumber: "20100066603",
              name: "Cliente de demostración VECA",
            },
            items: [
              {
                description: `DEMO · ${example.idea}`,
                unitCode: "NIU",
                quantity: 1,
                unitPrice: example.sale,
                includesTax: false,
              },
            ],
          }),
        });
    const parsed = demoDocument.safeParse(response);
    if (
      !parsed.success ||
      parsed.data.issuerRuc !== ruc ||
      (record.id && record.id !== parsed.data.id)
    )
      throw failure();
    const document = parsed.data;
    await this.collection.updateOne(
      { _id: example.key },
      {
        $set: {
          id: document.id,
          status: document.status,
          number: document.fullNumber ?? null,
        },
      },
    );
  }

  private async request(
    path: string,
    key: string,
    options: RequestInit = {},
  ): Promise<unknown> {
    try {
      const response = await this.fetch(path, key, options);
      return await response.json();
    } catch {
      throw failure();
    }
  }
  private async fetch(path: string, key: string, options: RequestInit = {}) {
    const response = await fetch(base + path, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { ...options.headers, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw failure();
    return response;
  }
}
