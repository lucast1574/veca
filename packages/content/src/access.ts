import { z } from "zod";
export const PERMISSIONS = [
  "dashboard",
  "projects",
  "leads",
  "works",
  "works_all",
  "works_manage",
  "works_report",
  "gallery",
  "inventory",
  "dispatches",
  "accounting",
  "users",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const roleSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
export type Role = string;
export type RoleDefinition = {
  id: Role;
  name: string;
  description: string;
  permissions: Permission[];
  revision: number;
};
export const accountStatusSchema = z.enum([
  "pending",
  "active",
  "rejected",
  "suspended",
]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;
export type SessionUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: Role | null;
  roleName: string | null;
  status: AccountStatus;
  emailVerified: boolean;
  avatarUrl: string | null;
  avatarSource: "google" | "upload" | "none";
  googlePhotoAvailable: boolean;
  authMethods: ("google" | "password")[];
  accountCreatedAt: string | null;
  permissions: Permission[];
};
export type UserSummary = SessionUser & {
  createdAt: string;
  revision: number;
  provider: "google" | "password";
};
export type AuthSession = { user: SessionUser; csrf: string };

export function canViewAdministration(user: SessionUser) {
  return (
    user.status === "active" &&
    user.emailVerified &&
    user.role === "admin" &&
    user.permissions.includes("users")
  );
}
