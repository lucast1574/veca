import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { guideItemDescription, type DispatchInput } from "@veca/content";
import { config } from "../common/config";
import { fiscalIssuerRuc, fiscalLiveKey } from "../common/fiscal-config";

const issuerUrl = "https://api.apisunat.net/api/v1/issuer";

export type GuideResult = {
  externalId: string;
  status: string;
  documentNumber?: string;
};

export class GuideRequestError extends Error {
  constructor(readonly definitive: boolean) {
    super("No se pudo confirmar la operación fiscal.");
  }
}

export function limaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

@Injectable()
export class GuideProvider {
  private get key() {
    return fiscalLiveKey;
  }

  private assertReady() {
    if (
      !this.key.startsWith("asu_live_") ||
      !/^\d{11}$/.test(fiscalIssuerRuc) ||
      (config.APISUNAT_GUIDE_SERIES &&
        !/^T[A-Z0-9]{3}$/.test(config.APISUNAT_GUIDE_SERIES))
    )
      throw new ServiceUnavailableException(
        "La emisión de guías aún no está habilitada. Consulta con administración.",
      );
  }

  async assertIssuerEnabled() {
    this.assertReady();
    const issuer = await this.request(`/issuers/${fiscalIssuerRuc}`)
      .then((response) => response.json())
      .catch(() => null);
    if (issuer?.ruc !== fiscalIssuerRuc || issuer?.livemode !== true)
      throw new ServiceUnavailableException(
        "No pudimos verificar el emisor en API SUNAT. Inténtalo nuevamente.",
      );
    if (issuer.active !== true || issuer.productionEnabled !== true)
      throw new ServiceUnavailableException(
        "El emisor aún no está habilitado en API SUNAT. La guía sigue guardada.",
      );
  }

  async issue(
    data: DispatchInput,
    key: string,
    date: string,
  ): Promise<GuideResult> {
    const isExternal = data.transportMode === "01";
    return this.result(
      await this.request("/guides", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          ruc: fiscalIssuerRuc,
          series: config.APISUNAT_GUIDE_SERIES || undefined,
          issueDate: date,
          transferDate: data.transferAt.slice(0, 10),
          startAddress: data.startAddress,
          startUbigeo: data.startUbigeo,
          arrivalAddress: data.arrivalAddress,
          arrivalUbigeo: data.arrivalUbigeo,
          motiveCode: data.motiveCode,
          motiveDescription:
            data.motiveCode === "13" ? data.motiveDescription : undefined,
          customer: {
            documentType: data.recipientType,
            documentNumber: data.recipientNumber,
            name: data.recipientName,
          },
          transportMode: data.transportMode,
          ...(isExternal
            ? { carrierRuc: data.carrierRuc, carrierName: data.carrierName }
            : {
                vehiclePlate: data.vehiclePlate
                  .replace(/[^a-z0-9]/gi, "")
                  .toUpperCase(),
                driverDocumentType: "1",
                driverDocument: data.driverDocument,
                driverName: data.driverName,
                driverLastName: data.driverLastName,
                driverLicense: data.driverLicense.toUpperCase(),
              }),
          weightKg: data.weightKg,
          items: data.items.map(({ materialId, dimensions, ...item }) => ({
            ...item,
            code: item.code || undefined,
            description: guideItemDescription({
              description: item.description,
              dimensions,
            }),
          })),
        }),
      }),
    );
  }

  async status(id: string) {
    return this.result(await this.request(`/guides/${encodeURIComponent(id)}`));
  }

  async pdf(id: string) {
    const response = await this.request(
      `/documents/${encodeURIComponent(id)}/pdf`,
    );
    if (
      response.headers.get("content-type")?.split(";")[0] !== "application/pdf"
    )
      throw new GuideRequestError(false);
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.subarray(0, 5).toString() !== "%PDF-")
      throw new GuideRequestError(false);
    return pdf;
  }

  private async request(path: string, options: RequestInit = {}) {
    this.assertReady();
    const response = await fetch(issuerUrl + path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.key}` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    // The contract rejects these statuses before creating a guide.
    if (!response.ok)
      throw new GuideRequestError(
        [400, 401, 402, 403, 422].includes(response.status),
      );
    return response;
  }

  private async result(response: Response): Promise<GuideResult> {
    const result = await response.json();
    if (
      typeof result?.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(result.id) ||
      result.type !== "09" ||
      result.test !== false ||
      result.issuerRuc !== fiscalIssuerRuc ||
      typeof result.status !== "string"
    )
      throw new GuideRequestError(false);
    return {
      externalId: result.id,
      status: result.status,
      documentNumber:
        typeof result.fullNumber === "string" ? result.fullNumber : undefined,
    };
  }
}
