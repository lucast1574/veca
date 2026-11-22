import {
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import type { AccountingInvoice } from "@veca/content";
import { config } from "../common/config";
import { fiscalIssuerRuc, fiscalLiveKey } from "../common/fiscal-config";

const url = "https://api.apisunat.net/api/v1/issuer";
const doc = z.object({
  id: z.uuid(),
  type: z.literal("01"),
  test: z.literal(false),
  issuerRuc: z.string(),
  status: z.string(),
  fullNumber: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
});
export type FiscalInvoice = z.infer<typeof doc>;

const issuerSchema = z.object({
  ruc: z.string(),
  active: z.boolean(),
  livemode: z.boolean(),
  productionEnabled: z.boolean(),
  credentials: z.object({
    produccion: z.object({
      configured: z.boolean(),
      hasCertificate: z.boolean(),
      certificateExpiresAt: z.string().nullable(),
      validatedAt: z.string().nullable(),
    }),
  }),
});
const seriesSchema = z.object({
  data: z.array(
    z.object({
      documentType: z.string(),
      series: z.string(),
      active: z.boolean(),
    }),
  ),
});

@Injectable()
export class InvoiceProvider {
  private get key() {
    return fiscalLiveKey;
  }

  get enabled() {
    return this.key.startsWith("asu_live_") && /^\d{11}$/.test(fiscalIssuerRuc);
  }

  async readiness() {
    if (!this.key.startsWith("asu_live_"))
      return { status: this.key ? "wrongKeyMode" : "missingKey" } as const;
    if (!/^\d{11}$/.test(fiscalIssuerRuc))
      return { status: "invalidIssuer" } as const;

    let response: Response;
    try {
      response = await this.readOnly(`/issuers/${fiscalIssuerRuc}`);
    } catch {
      return { status: "unreachable" } as const;
    }
    if (!response.ok)
      return { status: "issuerLookupFailed", http: response.status } as const;
    const parsed = issuerSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (
      !parsed.success ||
      parsed.data.ruc !== fiscalIssuerRuc ||
      !parsed.data.livemode
    )
      return { status: "invalidIssuer" } as const;
    const issuer = parsed.data;
    const credentials = issuer.credentials.produccion;
    const certificateExpired = credentials.certificateExpiresAt
      ? Date.parse(credentials.certificateExpiresAt) <= Date.now()
      : false;
    if (
      !issuer.active ||
      !issuer.productionEnabled ||
      !credentials.configured ||
      !credentials.hasCertificate ||
      !credentials.validatedAt ||
      certificateExpired
    )
      return {
        status: "notEnabled",
        active: issuer.active,
        productionEnabled: issuer.productionEnabled,
        certificate: credentials.hasCertificate,
        certificateExpired,
        credentials: credentials.configured,
        validated: Boolean(credentials.validatedAt),
      } as const;

    try {
      const res = await this.readOnly(`/series?ruc=${fiscalIssuerRuc}`);
      if (!res.ok)
        return { status: "seriesLookupFailed", http: res.status } as const;
      const parsedSeries = seriesSchema.safeParse(
        await res.json().catch(() => null),
      );
      if (!parsedSeries.success)
        return { status: "seriesLookupFailed" } as const;
      const invoiceSeries = parsedSeries.data.data
        .filter((row) => row.active && row.documentType === "01")
        .map((row) => row.series);
      const guideSeries = parsedSeries.data.data
        .filter(
          (row) =>
            row.active &&
            row.documentType === "09" &&
            (!config.APISUNAT_GUIDE_SERIES ||
              row.series === config.APISUNAT_GUIDE_SERIES),
        )
        .map((row) => row.series);
      return {
        status:
          invoiceSeries.length && guideSeries.length
            ? "ready"
            : "missingSeries",
        invoiceSeries,
        guideSeries,
      } as const;
    } catch {
      return { status: "unreachable" } as const;
    }
  }

  private readOnly(path: string) {
    return fetch(url + path, {
      redirect: "error",
      signal: AbortSignal.timeout(7_000),
      headers: { Authorization: `Bearer ${this.key}` },
    });
  }

  async issue(invoice: AccountingInvoice, attempt: string) {
    return this.document("/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": attempt,
      },
      body: JSON.stringify({
        documentType: "01",
        ruc: fiscalIssuerRuc,
        currency: "PEN",
        issueDate: invoice.issueDate,
        customer: {
          documentType: "6",
          documentNumber: invoice.customerRuc,
          name: invoice.customer,
        },
        paymentCondition: invoice.method,
        ...(invoice.method === "credit"
          ? {
              installments: [
                { date: invoice.dueDate, amount: invoice.totalCents / 100 },
              ],
            }
          : {}),
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantityMilli / 1000,
          unitPrice: item.unitCents / 100,
          unitCode: "NIU",
          includesTax: false,
          taxCode: "10",
        })),
      }),
    });
  }

  status(id: string) {
    return this.document(`/documents/${encodeURIComponent(id)}`);
  }

  async file(id: string, type: "pdf" | "xml" | "cdr") {
    const response = await this.request(
      `/documents/${encodeURIComponent(id)}/${type}`,
    );
    const file = Buffer.from(await response.arrayBuffer());
    if (type === "pdf" && file.subarray(0, 5).toString() !== "%PDF-")
      throw new ServiceUnavailableException(
        "El comprobante todavía no está disponible.",
      );
    return file;
  }

  private async document(
    path: string,
    options?: RequestInit,
  ): Promise<FiscalInvoice> {
    const response = await this.request(path, options);
    const parsed = doc.safeParse(await response.json());
    if (!parsed.success || parsed.data.issuerRuc !== fiscalIssuerRuc)
      throw new ServiceUnavailableException(
        "No se pudo confirmar la identidad del comprobante.",
      );
    return parsed.data;
  }

  private async request(path: string, options: RequestInit = {}) {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        "La emisión electrónica está pendiente de configuración.",
      );
    const response = await fetch(url + path, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { ...options.headers, Authorization: `Bearer ${this.key}` },
    });
    if ([400, 401, 402, 403, 409, 422].includes(response.status)) {
      const payload: unknown = await response.json().catch(() => null);
      const error = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(payload);
      const code = error.success ? error.data.error.code : "";
      const setup = [
        "ISSUER_NOT_CONFIGURED",
        "PRODUCTION_NOT_ENABLED",
        "ISSUER_FORBIDDEN",
      ].includes(code);
      if (setup || [401, 402, 403].includes(response.status))
        throw new BadRequestException(
          "La conexión fiscal requiere revisión. Contacta al administrador.",
        );
      if ([400, 422].includes(response.status))
        throw new BadRequestException(
          "Revisa los datos del cliente y los conceptos antes de emitir nuevamente.",
        );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        "No se pudo confirmar el comprobante.",
      );
    return response;
  }
}
