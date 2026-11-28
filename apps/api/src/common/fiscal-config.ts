import { createHash } from "node:crypto";
import { config } from "./config";

export const vecaTaxId = "20616656156";
export const isVecaProduction =
  config.NODE_ENV === "production" &&
  (new URL(config.PUBLIC_API_URL).hostname === "api.veca.com.pe" ||
    new URL(config.PANEL_ORIGIN).hostname === "panel.veca.com.pe");

const configuredRuc = config.APISUNAT_ISSUER_RUC.trim();
export const fiscalIssuerRuc = isVecaProduction
  ? !configuredRuc || configuredRuc === vecaTaxId
    ? vecaTaxId
    : ""
  : configuredRuc;

export const fiscalLiveKey =
  config.APISUNAT_LIVE_API_KEY.trim() || config.APISUNAT_API_KEY.trim();

export const fiscalAttemptScope = createHash("sha256")
  .update(JSON.stringify([fiscalIssuerRuc, fiscalLiveKey]))
  .digest("hex");

export type FiscalAttemptContext = { startedAt: string; scope: string };

export function canReplayFiscalAttempt(context?: FiscalAttemptContext) {
  if (context?.scope !== fiscalAttemptScope) return false;
  const age = Date.now() - Date.parse(context.startedAt);
  // API SUNAT keeps idempotency records for seven days. Leave a margin
  // for clock skew and requests arriving close to expiration.
  return age >= 0 && age < 6 * 24 * 60 * 60_000;
}
