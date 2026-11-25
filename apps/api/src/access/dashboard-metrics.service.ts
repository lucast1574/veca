import { Injectable } from "@nestjs/common";
import type { SessionUser } from "@veca/content";
import { Database } from "../database/database.module";
import { WorkAccess } from "../crm/work-access.service";
import { limaDate } from "../dispatch/guide-provider";
export const availableStockExpression = {
  $subtract: [
    "$balanceMilli",
    {
      $sum: {
        $map: {
          input: { $objectToArray: { $ifNull: ["$reservations", {}] } },
          as: "r",
          in: "$$r.v.quantity",
        },
      },
    },
  ],
};
@Injectable()
export class DashboardMetrics {
  constructor(
    private readonly database: Database,
    private readonly access: WorkAccess,
  ) {}
  async forUser(user: SessionUser) {
    const db = this.database.db,
      p = user.permissions;
    const current = limaDate(new Date()).slice(0, 7);
    const months = Array.from({ length: 6 }, (_, i) =>
      new Date(
        Date.UTC(
          Number(current.slice(0, 4)),
          Number(current.slice(5)) - 6 + i,
          1,
        ),
      )
        .toISOString()
        .slice(0, 7),
    );
    const scope = p.includes("leads") ? {} : this.access.scope(user);
    const [activity, stages, stock, publications] = await Promise.all([
      p.includes("leads") || p.includes("works")
        ? db
            .collection("crm_leads")
            .aggregate<{
              received: { _id: string; count: number }[];
              completed: { _id: string; count: number }[];
            }>([
              { $match: scope },
              {
                $facet: {
                  received: [
                    {
                      $match: {
                        createdAt: { $gte: months[0] + "-01T05:00:00.000Z" },
                      },
                    },
                    {
                      $group: {
                        _id: {
                          $dateToString: {
                            format: "%Y-%m",
                            date: {
                              $convert: {
                                input: "$createdAt",
                                to: "date",
                                onError: null,
                                onNull: null,
                              },
                            },
                            timezone: "America/Lima",
                            onNull: null,
                          },
                        },
                        count: { $sum: 1 },
                      },
                    },
                  ],
                  completed: [
                    {
                      $match: {
                        completedAt: { $gte: months[0] + "-01T05:00:00.000Z" },
                      },
                    },
                    {
                      $group: {
                        _id: {
                          $dateToString: {
                            format: "%Y-%m",
                            date: {
                              $convert: {
                                input: "$completedAt",
                                to: "date",
                                onError: null,
                                onNull: null,
                              },
                            },
                            timezone: "America/Lima",
                            onNull: null,
                          },
                        },
                        count: { $sum: 1 },
                      },
                    },
                  ],
                },
              },
            ])
            .next()
        : null,
      p.includes("works")
        ? db
            .collection("crm_leads")
            .aggregate<{ _id: string; count: number }>([
              { $match: this.access.scope(user) },
              { $group: { _id: "$stage", count: { $sum: 1 } } },
            ])
            .toArray()
        : [],
      p.includes("inventory")
        ? db
            .collection("inventory_materials")
            .aggregate<{ _id: string; count: number }>([
              { $set: { available: availableStockExpression } },
              {
                $group: {
                  _id: {
                    $cond: [
                      { $lte: ["$available", 0] },
                      "empty",
                      {
                        $cond: [
                          { $lte: ["$available", "$minimumMilli"] },
                          "low",
                          "available",
                        ],
                      },
                    ],
                  },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray()
        : null,
      p.includes("projects")
        ? db
            .collection("projects")
            .aggregate<{ _id: string; count: number }>([
              {
                $group: {
                  _id: {
                    $cond: [
                      { $ne: [{ $ifNull: ["$published", null] }, null] },
                      "published",
                      "draft",
                    ],
                  },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray()
        : null,
    ]);
    return {
      workStages: Object.fromEntries(stages.map((s) => [s._id, s.count])),
      activity: activity
        ? months.map((period) => ({
            period,
            received: p.includes("leads")
              ? activity.received.find((r) => r._id === period)?.count || 0
              : null,
            completed:
              activity.completed.find((r) => r._id === period)?.count || 0,
          }))
        : null,
      stock: stock
        ? Object.fromEntries(stock.map((s) => [s._id, s.count]))
        : null,
      publications: publications
        ? Object.fromEntries(publications.map((s) => [s._id, s.count]))
        : null,
    };
  }
}
