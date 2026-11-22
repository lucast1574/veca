import {
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import type { AccountingInvoice } from "@veca/content";
import { config } from "../common/config";

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

@Injectable()
export class InvoiceProvider {
  private get key() {
    return config.APISUNAT_LIVE_API_KEY || config.APISUNAT_API_KEY;
  }

  get enabled() {
    return (
      this.key.startsWith("asu_live_") &&
      /^\d{11}$/.test(config.APISUNAT_ISSUER_RUC)
    );
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
        ruc: config.APISUNAT_ISSUER_RUC,
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
    if (!parsed.success || parsed.data.issuerRuc !== config.APISUNAT_ISSUER_RUC)
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
