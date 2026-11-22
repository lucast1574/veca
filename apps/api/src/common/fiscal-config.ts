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
