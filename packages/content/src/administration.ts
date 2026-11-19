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
