import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import {
  canViewAdministration,
  SOCIAL_CHANNELS,
  socialChannelSchema,
  type AdministrationOverview,
  type ConnectionSnapshot,
  type SocialChannel,
  type SocialCheckGroup,
} from "@veca/content";
import { z } from "zod";
import { parse } from "../common/validation";
import { config } from "../common/config";
import { Database } from "../database/database.module";
import { AuthService } from "../auth/auth.service";
import { assignedRoles } from "../auth/auth.types";
import type { AuthenticatedRequest, UserDocument } from "../auth/auth.types";
import { RequirePermission } from "../auth/route-access";

type Activity = { _id: string; count: number; last: string };

@RequirePermission("users")
@Controller("admin/administration")
export class AdministrationController {
  constructor(
    private readonly database: Database,
    private readonly auth: AuthService,
  ) {}

  @Get("deliveries/:channel/review")
  async reviewDeliveries(
    @Req() request: AuthenticatedRequest,
    @Param("channel") value: string,
    @Query("page") rawPage = "1",
  ) {
    if (!canViewAdministration(request.session.user))
      throw new ForbiddenException(
        "Esta sección es exclusiva de administradores.",
      );
    const channel = parse(socialChannelSchema, value);
    const page = parse(z.coerce.number().int().min(1).max(10000), rawPage);
    const delivery = `socialShare.channels.${channel}`;
    const rows = await this.database.db
      .collection("projects")
      .find({ published: { $ne: null }, [delivery + ".state"]: "review" })
      .project({ slug: 1, "published.title": 1, [delivery + ".at"]: 1 })
      .sort({ [delivery + ".at"]: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(21)
      .toArray();
    return {
      hasMore: rows.length > 20,
      items: rows.slice(0, 20).map((row) => ({
        id: String(row._id),
        slug: row.slug,
        title: row.published?.title,
        at: row.socialShare?.channels?.[channel]?.at,
      })),
    };
  }

  @Get()
  async overview(
    @Req() request: AuthenticatedRequest,
  ): Promise<AdministrationOverview> {
    if (!canViewAdministration(request.session.user))
      throw new ForbiddenException(
        "Esta sección es exclusiva de administradores.",
      );

    const now = Date.now();
    const since = new Date(now - 30 * 86400000).toISOString();
    const db = this.database.db;
    const projects = db.collection("projects");
    const leads = db.collection("crm_leads");
    const [
      published,
      drafts,
      preleads,
      leadSources,
      snapshots,
      deliveryRows,
      users,
      roles,
      crmActivity,
      inventoryActivity,
    ] = await Promise.all([
      projects.countDocuments({ published: { $ne: null } }),
      projects.countDocuments({ published: null }),
      leads.countDocuments({ stage: "prelead" }),
      leads
        .aggregate<{
          _id: string;
          count: number;
        }>([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: "$source", count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<
          ConnectionSnapshot & { _id: SocialCheckGroup }
        >("social_checks")
        .find()
        .toArray(),
      projects
        .aggregate<{
          _id: { channel: SocialChannel; state: string };
          count: number;
        }>([
          {
            $match: {
              "socialShare.queuedAt": { $exists: true },
              published: { $ne: null },
            },
          },
          {
            $project: {
              deliveries: SOCIAL_CHANNELS.map((channel) => ({
                channel,
                state: {
                  $ifNull: [
                    `$socialShare.channels.${channel}.state`,
                    "pending",
                  ],
                },
              })),
            },
          },
          { $unwind: "$deliveries" },
          { $group: { _id: "$deliveries", count: { $sum: 1 } } },
        ])
        .toArray(),
      this.auth.users
        .find()
        .sort({ name: 1, username: 1 })
        .project<UserDocument>({
          name: 1,
          username: 1,
          role: 1,
          roles: 1,
          status: 1,
          email: 1,
          emailVerified: 1,
        })
        .toArray(),
      this.auth.roles.list(),
      leads
        .aggregate<Activity>([
          { $match: { "events.at": { $gte: since } } },
          { $unwind: "$events" },
          {
            $match: {
              "events.at": { $gte: since },
              $or: [
                { "events.kind": { $ne: "created" } },
                { source: "manual" },
              ],
            },
          },
          {
            $group: {
              _id: "$events.actor",
              count: { $sum: 1 },
              last: { $max: "$events.at" },
            },
          },
        ])
        .toArray(),
      db
        .collection("inventory_movements")
        .aggregate<Activity>([
          { $match: { at: { $gte: since } } },
          {
            $group: {
              _id: "$actor",
              count: { $sum: 1 },
              last: { $max: "$at" },
            },
          },
        ])
        .toArray(),
    ]);
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    const crm = new Map(
      crmActivity.map((activity) => [activity._id, activity]),
    );
    const inventory = new Map(
      inventoryActivity.map((activity) => [activity._id, activity]),
    );
    const sources = new Map(leadSources.map(({ _id, count }) => [_id, count]));
    const byChannel = {} as AdministrationOverview["leads"]["byChannel"];
    const deliveries = {} as AdministrationOverview["deliveries"];
    for (const channel of SOCIAL_CHANNELS) {
      byChannel[channel] = sources.get(channel) ?? 0;
      deliveries[channel] = { published: 0, pending: 0, review: 0 };
    }
    for (const {
      _id: { channel, state },
      count,
    } of deliveryRows) {
      const bucket =
        state === "published" || state === "review" ? state : "pending";
      deliveries[channel][bucket] += count;
    }
    return {
      demoEnabled: config.NODE_ENV !== "production",
      asOf: new Date(now).toISOString(),
      projects: { published, drafts },
      leads: {
        received: leadSources.reduce((total, { count }) => total + count, 0),
        preleads,
        byChannel,
      },
      connections: Object.fromEntries(
        snapshots.map(({ _id, ...snapshot }) => [_id, snapshot]),
      ),
      deliveries,
      team: users.map((user) => {
        const c = crm.get(user.username),
          i = inventory.get(user.username);
        const legacyAdmin = user.username === "admin" && !user.email;
        return {
          id: String(user._id),
          name: user.name || (legacyAdmin ? "Administrador" : user.username),
          role:
            assignedRoles(user)
              .map((id) => roleNames.get(id))
              .filter(Boolean)
              .join(" · ") || null,
          status: user.status ?? (legacyAdmin ? "active" : "pending"),
          activity: {
            crm: c?.count ?? 0,
            inventory: i?.count ?? 0,
            last: [c?.last, i?.last].filter(Boolean).sort().at(-1) ?? null,
          },
        };
      }),
    };
  }
}
