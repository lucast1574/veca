import type { AccountStatus } from "./access.js";
import type { SocialChannel } from "./crm.js";

export type ConnectionState =
  | "verified"
  | "login"
  | "redirected"
  | "unconfirmed"
  | "unavailable";
export type SocialCheckGroup = "publications" | "inboxes";
export type SocialCheck = {
  channel: SocialChannel;
  status: ConnectionState;
};
export type ConnectionSnapshot = {
  checkedAt: string;
  accounts: SocialCheck[];
};
export type AdministrationOverview = {
  demoEnabled: boolean;
  asOf: string;
  projects: { published: number; drafts: number };
  leads: {
    received: number;
    preleads: number;
    byChannel: Record<SocialChannel, number>;
  };
  connections: Partial<Record<SocialCheckGroup, ConnectionSnapshot>>;
  deliveries: Record<
    SocialChannel,
    { published: number; pending: number; review: number }
  >;
  team: {
    id: string;
    name: string;
    role: string | null;
    status: AccountStatus;
    activity: { crm: number; inventory: number; last: string | null };
  }[];
};

export type FiscalOverview = {
  status:
    | "ready"
    | "missingKey"
    | "wrongKeyMode"
    | "invalidIssuer"
    | "unreachable"
    | "issuerLookupFailed"
    | "seriesLookupFailed"
    | "notEnabled"
    | "missingSeries";
  http?: number;
  invoiceSeries?: string[];
  guideSeries?: string[];
  active?: boolean;
  credentials?: boolean;
  certificate?: boolean;
  certificateExpired?: boolean;
  validated?: boolean;
  productionEnabled?: boolean;
  cleanup: {
    deleted: {
      leads: number;
      dispatches: number;
      files: number;
      invoices: number;
      blocked: number;
    } | null;
    remaining: { leads: number; dispatches: number; invoices: number };
  };
};
