import type { ObjectId } from "mongodb";
import type { Request } from "express";
import type { Role, AccountStatus, SessionUser } from "@veca/content";
export interface UserDocument {
  _id: ObjectId;
  username: string;
  role: Role | null;
  roles?: Role[];
  passwordHash: string | null;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  status?: AccountStatus;
  firebaseUid?: string;
  googlePhotoUrl?: string | null;
  avatarSource?: "google" | "upload" | "none";
  avatarKey?: string;
  avatarVersion?: string;
  provider?: "google" | "password";
  revision?: number;
  setupHash?: string;
  setupExpires?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  trustedInvitation?: boolean;
  mobileReview?: boolean;
  accessEvents?: {
    actor: string;
    at: Date;
    from: { role: Role | null; roles?: Role[]; status?: AccountStatus };
    to: { role: Role | null; roles?: Role[]; status: AccountStatus };
  }[];
}
export function assignedRoles(user: Pick<UserDocument, "role" | "roles">) {
  return user.roles ?? (user.role ? [user.role] : []);
}

export interface SessionDocument {
  _id?: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  mobile?: boolean;
  csrf: string;
  expiresAt: Date;
}
export type AuthenticatedSession = SessionDocument & { user: SessionUser };
export type AuthenticatedRequest = Request & { session: AuthenticatedSession };
