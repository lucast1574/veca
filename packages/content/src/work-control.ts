import type { AccountingMargin } from "./accounting.js";
export type WorkCheck = {
  key: string;
  label: string;
  count: number;
  blocking: boolean;
};
export type WorkCloseout = {
  stage: string;
  checks: WorkCheck[];
  ready: boolean;
};
export type WorkFinancials = {
  margin: AccountingMargin;
  counts: { invoices: number; costs: number; guides: number };
  invoices: {
    id: string;
    number: string;
    status: string;
    total: number;
    paid: number;
  }[];
  costs: { id: string; supplier: string; reviewed: boolean; proof: boolean }[];
  guides: {
    id: string;
    number: string;
    version: number;
    status: string;
    canOpen: boolean;
    departed: boolean;
  }[];
};
export type InboxItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
};
export type InboxSection = {
  key: string;
  title: string;
  count: number;
  href: string;
  items: InboxItem[];
};
