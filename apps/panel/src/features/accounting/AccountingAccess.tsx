import { createContext, useContext } from "react";
import type { Permission } from "@veca/content";
export const AccountingAccess = createContext<readonly Permission[]>([]);
export const useAccountingPermission = (permission: Permission) =>
  useContext(AccountingAccess).includes(permission);
