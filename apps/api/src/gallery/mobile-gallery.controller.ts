import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { digest } from "../auth/auth.crypto";
import { PublicEndpoint } from "../auth/route-access";
import { config } from "../common/config";
import { parse } from "../common/validation";
import { Database } from "../database/database.module";
import { GalleryService } from "./gallery.service";
import { MediaService } from "../media/media.service";

const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const photos = [
  ["fachada", "Fachada de vidrio", "facade.webp"],
  ["interior", "División interior", "interior.webp"],
  ["mampara", "Mampara corredera", "mamparas.webp"],
  ["oficina", "Cristalería de oficina", "oficina.webp"],
  ["detalle", "Detalle de instalación", "detail.webp"],
  ["ventana", "Ventana residencial", "vivienda.webp"],
].map(([id, title, file]) => ({
  id,
  title,
  subtitle: "Foto de muestra",
  url: new URL("/assets/" + file, config.SITE_ORIGIN).href,
}));

@PublicEndpoint()
@Controller("mobile")
export class MobileGalleryController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: Database,
    private readonly gallery: GalleryService,
    private readonly media: MediaService,
  ) {}

  private get codes() {
    return this.database.db.collection<{
      _id: string;
      challenge: string;
      userId: ObjectId;
      expiresAt: Date;
    }>("mobile_login_codes");
  }

  private token(req: Request) {
    return (
      req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || ""
    );
  }

  private async access(req: Request) {
    const { user, userId } = await this.auth.authenticate(
      this.token(req),
      true,
    );
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

  @Post("auth/login")
  async login(
    @Body() input: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    const { username, password } = parse(
      z
        .object({
          username: z.string().min(1).max(180),
          password: z.string().min(1).max(256),
        })
        .strict(),
      input,
    );
    const result = await this.auth.login(username, password, true);
    if (!("token" in result))
      throw new ForbiddenException(
        "Confirma tu correo en el panel de VECA para continuar.",
      );
    return { token: result.token };
  }

  @Post("auth/google")
  async google(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.get("origin") !== config.SITE_ORIGIN)
      throw new ForbiddenException();
    res.set("Cache-Control", "no-store");
    const { idToken, challenge } = parse(
      z
        .object({
          idToken: z.string().min(20).max(10000),
          challenge: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      input,
    );
    const userId = await this.auth.googleUser(idToken, true);
    const code = randomBytes(32).toString("base64url");
    await this.codes.insertOne({
      _id: digest(code),
      userId,
      challenge,
      expiresAt: new Date(Date.now() + 120_000),
    });
    return { code };
  }

  @Post("auth/exchange")
  async exchange(
    @Body() input: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "no-store");
    const { code, verifier } = parse(
      z.object({ code: secret, verifier: secret }).strict(),
      input,
    );
    const grant = await this.codes.findOneAndDelete({
      _id: digest(code),
      challenge: digest(verifier),
      expiresAt: { $gt: new Date() },
    });
    if (!grant)
      throw new UnauthorizedException(
        "El acceso ha caducado. Vuelve a iniciarlo.",
      );
    const { token } = await this.auth.session(grant.userId, true);
    return { token };
  }

  @Get("auth/me")
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set("Cache-Control", "no-store");
    const { user, review } = await this.access(req);
    return {
      name: user.name,
      email: user.email,
      review,
      hasPassword: user.authMethods.includes("password"),
    };
  }

  @Post("auth/logout")
  async logout(@Req() req: Request) {
    const token = this.token(req);
    await this.auth.authenticate(token, true);
    await this.auth.logout(token);
    return { ok: true };
  }

  @Get("photos")
  async list(
    @Req() req: Request,
    @Query() input: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set("Cache-Control", "private, no-store");
    const { user, review } = await this.access(req);
    const { search, page } = parse(
      z
        .object({
          search: z.string().trim().max(120).default(""),
          page: z.coerce.number().int().min(1).max(10000).default(1),
        })
        .strict(),
      input,
    );
    if (review) {
      const items = photos.filter((p) =>
        p.title.toLowerCase().includes(search.toLowerCase()),
      );
      return {
        items: page === 1 ? items : [],
        total: items.length,
        pages: items.length ? 1 : 0,
      };
    }
    const result = await this.gallery.list(
      { search, page },
      user.permissions.includes("projects"),
    );
    const items = result.items.map((photo) => {
      if (photo.source === "lead")
        return {
          id: photo.id,
          url: "/mobile/photos/" + photo.id,
          title: photo.caption || photo.name,
          subtitle: photo.lead.district || "Obra",
        };
      const url = new URL(photo.url, config.PUBLIC_API_URL);
      const media =
        url.origin === new URL(config.PUBLIC_API_URL).origin &&
        /^\/media\/[a-f0-9]{24}$/.test(url.pathname);
      return {
        id: photo.id,
        url: media ? "/mobile" + url.pathname : url.href,
        title: photo.caption || photo.alt || photo.publication.title,
        subtitle: photo.publication.location || "Proyecto",
      };
    });
    return { items, total: result.total, pages: result.pages };
  }

  @Get("photos/:id")
  async photo(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if ((await this.access(req)).review) throw new ForbiddenException();
    this.send(res, (await this.gallery.read(id)).file);
  }

  @Get("media/:id")
  async publication(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if ((await this.access(req)).review) throw new ForbiddenException();
    this.send(res, await this.media.read(id, this.token(req), true));
  }

  private send(
    res: Response,
    file: { Body?: unknown; ContentLength?: number },
  ) {
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    });
    if (file.ContentLength)
      res.set("Content-Length", String(file.ContentLength));
    (file.Body as Readable).pipe(res);
  }
}
