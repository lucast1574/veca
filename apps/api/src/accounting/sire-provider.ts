import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { fiscalIssuerRuc, fiscalLiveKey } from "../common/fiscal-config";

const proposal = z.object({
  job: z.string().min(1).max(2000),
  ruc: z.string().regex(/^\d{11}$/),
  period: z.string(),
  book: z.enum(["purchases", "sales"]),
  status: z.enum(["pending", "ready"]),
  files: z
    .array(
      z.object({ name: z.string().max(255), text: z.string().max(8_000_000) }),
    )
    .max(100)
    .optional(),
});

@Injectable()
export class SireProvider {
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    data?: object,
  ): Promise<T> {
    if (
      !fiscalLiveKey.startsWith("asu_live_") ||
      !/^\d{11}$/.test(fiscalIssuerRuc)
    )
      throw new ServiceUnavailableException(
        "La consulta automática aún no está disponible. Pide a Administración revisar la conexión con SUNAT.",
      );
    let response: Response;
    let bytes: Buffer;
    try {
      response = await fetch(
        `https://api.apisunat.net/api/v1/issuer/issuers/${fiscalIssuerRuc}/sire/${path}`,
        {
          method: data ? "POST" : "GET",
          redirect: "error",
          signal: AbortSignal.timeout(25_000),
          headers: {
            "X-API-Key": fiscalLiveKey,
            "Content-Type": "application/json",
          },
          ...(data && { body: JSON.stringify(data) }),
        },
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.length;
          if (size > 16_000_000) throw new Error("Response too large");
          chunks.push(item.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      bytes = Buffer.concat(chunks);
    } catch {
      throw new ServiceUnavailableException(
        "La consulta de SUNAT tardó demasiado o no está disponible. Puedes reintentar o comparar un archivo TXT.",
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new ServiceUnavailableException(
        "No pudimos leer la propuesta de SUNAT. Vuelve a consultar.",
      );
    }
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(body);
      if (error.success && error.data.error.code === "SIRE_INVALID_JOB")
        throw new BadRequestException(
          "Esta consulta venció. Cierra la ventana y vuelve a abrir Comparar con SUNAT para iniciar otra.",
        );
      if (
        error.success &&
        ["SIRE_NOT_CONFIGURED", "SIRE_NOT_AUTHORIZED"].includes(
          error.data.error.code,
        )
      )
        throw new BadRequestException(
          "SUNAT necesita autorizar la consulta de SIRE. Pide a Administración revisar el acceso; puedes usar el TXT mientras tanto.",
        );
      throw new ServiceUnavailableException(
        "SUNAT no pudo completar la consulta. Reintenta o compara un archivo TXT del periodo.",
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ServiceUnavailableException(
        "La propuesta recibida de SUNAT está incompleta. Vuelve a consultar.",
      );
    return parsed.data;
  }
  connection() {
    return this.request("connection", z.object({ configured: z.boolean() }));
  }
  start(period: string, book: "sales" | "purchases") {
    return this.request("proposals", proposal, { period, book });
  }
  poll(job: string) {
    return this.request("proposals/" + encodeURIComponent(job), proposal);
  }
}
