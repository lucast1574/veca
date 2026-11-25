import { Injectable } from "@nestjs/common";
import { costKinds, type AccountingTrends } from "@veca/content";
import { Database } from "../database/database.module";

@Injectable()
export class AccountingTrendsService {
  constructor(private readonly db: Database) {}

  async overview(month: string): Promise<AccountingTrends> {
    const anchor = new Date(`${month}-01T12:00:00.000Z`);
    const periods = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(anchor);
      date.setUTCMonth(date.getUTCMonth() - 5 + index);
      return date.toISOString().slice(0, 7);
    });
    const dates = { $gte: periods[0] + "-01", $lte: month + "-31" };
    type Totals = { _id: string; net: number; tax: number };
    const [sales, costs] = await Promise.all([
      this.db.db
        .collection("accounting_invoices")
        .aggregate<Totals>([
          {
            $match: {
              issueDate: dates,
              status: { $in: ["accepted", "observed"] },
            },
          },
          {
            $group: {
              _id: { $substrBytes: ["$issueDate", 0, 7] },
              net: { $sum: "$netCents" },
              tax: { $sum: "$taxCents" },
            },
          },
        ])
        .toArray(),
      this.db.db
        .collection("accounting_costs")
        .aggregate<{
          months: Totals[];
          categories: {
            _id: AccountingTrends["costBreakdown"][number]["kind"];
            net: number;
          }[];
        }>([
          { $match: { date: dates, kind: { $ne: "materials" } } },
          {
            $facet: {
              months: [
                {
                  $group: {
                    _id: { $substrBytes: ["$date", 0, 7] },
                    net: { $sum: "$netCents" },
                    tax: { $sum: "$taxCents" },
                  },
                },
              ],
              categories: [
                {
                  $match: {
                    date: { $gte: month + "-01", $lte: month + "-31" },
                  },
                },
                {
                  $group: {
                    _id: {
                      $cond: [{ $in: ["$kind", costKinds] }, "$kind", "other"],
                    },
                    net: { $sum: "$netCents" },
                  },
                },
                { $sort: { net: -1 } },
              ],
            },
          },
        ])
        .next(),
    ]);
    return {
      months: periods.map((period) => {
        const sale = sales.find((row) => row._id === period);
        const cost = costs?.months.find((row) => row._id === period);
        return {
          period,
          salesNet: sale?.net || 0,
          salesTax: sale?.tax || 0,
          costsNet: cost?.net || 0,
          costsTax: cost?.tax || 0,
        };
      }),
      costBreakdown: (costs?.categories || []).map((row) => ({
        kind: row._id,
        netCents: row.net,
      })),
    };
  }
}
