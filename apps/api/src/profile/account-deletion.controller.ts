import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { verify } from "argon2";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { PublicEndpoint } from "../auth/route-access";
import { config } from "../common/config";
import { parse } from "../common/validation";
import { Database } from "../database/database.module";
import { StorageService } from "../media/storage.service";

const credentials = z.union([
  z.object({ idToken: z.string().min(20).max(10000) }).strict(),
  z
    .object({
      username: z.string().trim().min(1).max(180),
      password: z.string().min(1).max(256),
    })
    .strict(),
]);

@PublicEndpoint()
@Controller("account/delete")
export class AccountDeletionController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: Database,
    private readonly storage: StorageService,
  ) {}

  @Post()
  async remove(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.get("origin") !== config.SITE_ORIGIN)
      throw new ForbiddenException();
    res.set("Cache-Control", "no-store");
    const proof = parse(credentials, input);
    const identity =
      "idToken" in proof ? await this.auth.googleIdentity(proof.idToken) : null;
    if (identity && Date.now() / 1000 - identity.auth_time > 300)
      throw new UnauthorizedException(
        "Vuelve a confirmar tu identidad con Google.",
      );
    const user = await this.auth.users.findOne(
      identity
        ? { firebaseUid: identity.uid }
        : { username: "username" in proof ? proof.username.toLowerCase() : "" },
    );
    if (!user || (user.username === "admin" && !user.email))
      throw new UnauthorizedException(
        "No encontramos una cuenta que coincida con esos datos.",
      );
    if ("password" in proof) {
      if (
        !user.passwordHash ||
        !(await verify(user.passwordHash, proof.password))
      )
        throw new UnauthorizedException("Correo o contraseña incorrectos.");
      if (user.firebaseUid)
        throw new ForbiddenException(
          "Confirma con Google para eliminar esta cuenta vinculada.",
        );
    }

    const db = this.database.db;
    if (user.avatarKey) await this.storage.remove(user.avatarKey);
    await Promise.all([
      db.collection("verification_challenges").deleteMany({ userId: user._id }),
      db.collection("mobile_login_codes").deleteMany({ userId: user._id }),
      db.collection<{ _id: string; to: string }>("mail_deliveries").deleteMany({
        $or: [
          { _id: "access-request:" + user._id },
          { to: user.email || user.username },
        ],
      }),
      db.collection("sessions").deleteMany({ userId: user._id }),
    ]);
    if ("idToken" in proof) await this.removeFirebaseUser(proof.idToken);
    await this.auth.users.deleteOne({ _id: user._id });
    return { ok: true };
  }

  private async removeFirebaseUser(idToken: string) {
    const result = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" +
        encodeURIComponent(config.FIREBASE_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() => null);
    if (result?.ok) return;
    const response = await result?.json().catch(() => null);
    if (response?.error?.message === "USER_NOT_FOUND") return;
    throw new ServiceUnavailableException(
      "No se pudo completar el borrado con Google. Intenta nuevamente.",
    );
  }
}
