import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { SessionUser } from "@veca/content";
import type { Request } from "express";
import type { ObjectId } from "mongodb";
import { AuthService } from "../auth/auth.service";

export type MobileGalleryUploadRequest = Request & { galleryUser: SessionUser };

@Injectable()
export class MobileGalleryAccess implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  token(req: Request) {
    return (
      req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || ""
    );
  }

  async forUser(user: SessionUser, userId: ObjectId) {
    if (user.status !== "active" || !user.emailVerified)
      throw new ForbiddenException("Tu cuenta de VECA no tiene acceso activo.");
    const review = !!(await this.auth.users.findOne({
      _id: userId,
      mobileReview: true,
    }));
    if (!review && !user.permissions.includes("gallery"))
      throw new ForbiddenException("Tu cuenta no tiene acceso a Galería.");
    return { user, review };
  }

  async resolve(req: Request) {
    const { user, userId } = await this.auth.authenticate(
      this.token(req),
      true,
    );
    return this.forUser(user, userId);
  }

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<MobileGalleryUploadRequest>();
    const { user, review } = await this.resolve(req);
    if (review)
      throw new ForbiddenException(
        "La cuenta de muestra no puede subir fotos.",
      );
    req.galleryUser = user;
    return true;
  }
}
