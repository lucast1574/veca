import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Sse,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SOCIAL_CHANNELS,
  socialChannelSchema,
  type ConnectionSnapshot,
  type SocialCheckGroup,
} from "@veca/content";
import { equal } from "../auth/auth.crypto";
import { PublicEndpoint } from "../auth/route-access";
import { config } from "../common/config";
import { parse } from "../common/validation";
import { ProjectsRepository } from "./projects.repository";
import { ProjectsService } from "./projects.service";
import { Database } from "../database/database.module";

const checkSchema = z
  .object({
    group: z.enum(["publications", "inboxes"]),
    accounts: z
      .array(
        z
          .object({
            channel: socialChannelSchema,
            status: z.enum([
              "verified",
              "login",
              "redirected",
              "unconfirmed",
              "unavailable",
            ]),
          })
          .strict(),
      )
      .length(SOCIAL_CHANNELS.length)
      .refine(
        (accounts) =>
          new Set(accounts.map(({ channel }) => channel)).size ===
          SOCIAL_CHANNELS.length,
      ),
  })
  .strict();

const outcomeSchema = z
  .object({
    claim: z.uuid(),
    outcome: z.enum(["published", "review", "retry"]),
    reason: z.enum([
      "",
      "session",
      "editor",
      "media",
      "confirmation",
      "withdrawn",
    ]),
  })
  .strict();

@PublicEndpoint()
@Controller("integrations/social")
export class SocialDeliveryController {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly database: Database,
    private readonly service: ProjectsService,
  ) {}

  private authorize(authorization: string | undefined) {
    if (
      !config.SOCIAL_DELIVERY_TOKEN ||
      !equal(authorization ?? "", "Bearer " + config.SOCIAL_DELIVERY_TOKEN)
    ) {
      throw new UnauthorizedException();
    }
  }

  @Post("dispatch")
  @HttpCode(200)
  dispatch(@Headers("authorization") authorization: string | undefined) {
    this.authorize(authorization);
    return { started: this.service.wakeSocialWorkflow() };
  }

  @Sse("publication-events")
  publicationEvents(
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.authorize(authorization);
    return this.service.publicationNotifications();
  }

  @Post("health")
  @HttpCode(200)
  async reportHealth(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ) {
    this.authorize(authorization);
    const { group, accounts } = parse(checkSchema, input);
    const checkedAt = new Date().toISOString();
    await this.database.db
      .collection<
        ConnectionSnapshot & { _id: SocialCheckGroup }
      >("social_checks")
      .updateOne(
        { _id: group },
        { $set: { accounts, checkedAt } },
        { upsert: true },
      );
    return { ok: true, checkedAt };
  }

  @Post(":channel/claim")
  @HttpCode(200)
  async claim(
    @Headers("authorization") authorization: string | undefined,
    @Param("channel") input: string,
  ) {
    this.authorize(authorization);
    const channel = parse(socialChannelSchema, input);
    const field = `socialShare.channels.${channel}`;
    const at = new Date().toISOString();
    const claim = randomUUID();
    const job = await this.projects.collection.findOneAndUpdate(
      {
        "socialShare.queuedAt": { $exists: true },
        published: { $ne: null },
        $or: [
          { [field]: { $exists: false } },
          { [field + ".state"]: "retry", [field + ".nextAt"]: { $lte: at } },
        ],
      },
      { $set: { [field]: { state: "processing", claim, at } } },
      { sort: { "socialShare.queuedAt": 1 }, returnDocument: "after" },
    );
    if (!job?.published) return { job: null };
    const project = job.published;
    if (!project.coverId)
      throw new BadRequestException("La obra no tiene portada.");
    return {
      job: {
        id: String(job._id),
        claim,
        title: project.title,
        description: project.excerpt || project.seo.description,
        ...(project.excerpt?.trim() && { caption: project.excerpt.trim() }),
        url: new URL(`/proyectos/${job.slug}/`, config.SITE_ORIGIN).href,
        cover: new URL(`/media/${project.coverId}`, config.PUBLIC_API_URL).href,
        images: [
          project.coverId,
          ...project.images
            .map(({ id }) => id)
            .filter((id) => id !== project.coverId),
        ].map((id) => new URL(`/media/${id}`, config.PUBLIC_API_URL).href),
      },
    };
  }

  @Post(":channel/:id/check")
  @HttpCode(200)
  async check(
    @Headers("authorization") authorization: string | undefined,
    @Param("channel") input: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.authorize(authorization);
    const channel = parse(socialChannelSchema, input);
    const { claim } = parse(z.object({ claim: z.uuid() }).strict(), body);
    const doc = await this.projects.get(id);
    const delivery = doc.socialShare?.channels?.[channel];
    return {
      ready:
        !!doc.published &&
        delivery?.state === "processing" &&
        delivery.claim === claim,
    };
  }

  @Post(":channel/:id/complete")
  @HttpCode(200)
  async complete(
    @Headers("authorization") authorization: string | undefined,
    @Param("channel") input: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.authorize(authorization);
    const channel = parse(socialChannelSchema, input);
    const { claim, outcome, reason } = parse(outcomeSchema, body);
    const field = `socialShare.channels.${channel}`;
    const idValue = this.projects.id(id);
    const current = await this.projects.collection.findOne(
      { _id: idValue },
      { projection: { [field]: 1 } },
    );
    if (!current) throw new NotFoundException();
    const prior = current.socialShare?.channels?.[channel];
    if (prior?.claim === claim && prior.state === outcome) return { ok: true };
    const saved = await this.projects.collection.updateOne(
      {
        _id: idValue,
        [field + ".state"]: "processing",
        [field + ".claim"]: claim,
      },
      {
        $set: {
          [field]: {
            state: outcome,
            reason,
            claim,
            at: new Date().toISOString(),
            ...(outcome === "retry" && {
              nextAt: new Date(Date.now() + 3600000).toISOString(),
            }),
          },
        },
      },
    );
    if (!saved.matchedCount)
      throw new ConflictException("La entrega ya cambió.");
    return { ok: true };
  }
}
