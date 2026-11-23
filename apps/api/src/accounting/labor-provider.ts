import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  laborEmployee,
  laborReceipt,
  laborRegime,
  payrollRun,
} from "@veca/content";
import { z } from "zod";
import { fiscalIssuerRuc, fiscalLiveKey } from "../common/fiscal-config";

@Injectable()
export class LaborProvider {
  private readonly logger = new Logger(LaborProvider.name);

  private connectionUnavailable(reason: string) {
    this.logger.warn(reason);
    return new ServiceUnavailableException(
      "La conexión con API SUNAT no está disponible. Comunícate con el equipo de soporte.",
    );
  }

  employees() {
    return this.request("employees", z.array(laborEmployee));
  }
  regimes() {
    return this.request("regimes", z.array(laborRegime));
  }
  runs() {
    return this.request("runs", z.array(payrollRun));
  }
  async receipts() {
    const rows = await this.request("receipts", z.array(laborReceipt));
    return rows.filter(({ direction }) => direction === "received");
  }

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    command?: { method: "POST" | "PUT"; data: object },
  ): Promise<T> {
    if (
      !fiscalLiveKey.startsWith("asu_live_") ||
      !/^\d{11}$/.test(fiscalIssuerRuc)
    )
      throw this.connectionUnavailable(
        "Labor issuer configuration is missing or invalid.",
      );
    let response: Response;
    try {
      response = await fetch(
        `https://api.apisunat.net/api/v1/issuer/issuers/${fiscalIssuerRuc}/payroll/${path}`,
        {
          method: command?.method ?? "GET",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: {
            "X-API-Key": fiscalLiveKey,
            "Content-Type": "application/json",
          },
          ...(command && { body: JSON.stringify(command.data) }),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        command
          ? "API SUNAT no confirmó el cambio. Revisa el registro antes de volver a guardarlo."
          : "No pudimos conectar con el módulo laboral de API SUNAT.",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ message: z.string().max(400) }) })
        .safeParse(body);
      const message = error.success
        ? error.data.error.message
        : "API SUNAT rechazó la operación.";
      if (response.status === 409) throw new ConflictException(message);
      if ([400, 422].includes(response.status))
        throw new BadRequestException(message);
      if ([401, 403, 404].includes(response.status))
        throw this.connectionUnavailable(
          `Labor provider authorization failed (HTTP ${response.status}).`,
        );
      throw new ServiceUnavailableException(
        "API SUNAT no pudo completar la operación. Consulta los datos antes de volver a guardar.",
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ServiceUnavailableException(
        "API SUNAT devolvió un registro laboral incompleto.",
      );
    return parsed.data;
  }
}
