import test from "node:test";
import assert from "node:assert/strict";
import {
  marginBridge,
  marginBreakdown,
  percentage,
  progress,
} from "../apps/panel/src/features/accounting/margin-model";
import type { AccountingMargin } from "@veca/content";

test("margin charts preserve losses, zero revenue and over-budget percentages", () => {
  assert.equal(percentage(-5000, 10000), -50);
  assert.equal(percentage(1, 0), null);
  assert.equal(progress(15000, 10000), 100);
  assert.equal(progress(-100, 10000), 0);
  for (const [sales, costs] of [
    [0, 0],
    [0, 5000],
    [10000, 15000],
    [10000, 0],
    [10000, -1000],
  ]) {
    const chart = marginBridge(sales, costs);
    assert.equal(chart.columns[2].value, sales - costs);
    for (const column of chart.columns) {
      assert.ok(Number.isFinite(chart.y(column.from)));
      assert.ok(chart.y(column.from) >= 42 && chart.y(column.from) <= 162);
      assert.ok(chart.y(column.to) >= 42 && chart.y(column.to) <= 162);
    }
  }
});

test("cost distribution retains exact totals and credits without mutating the report", () => {
  const rows: AccountingMargin["costBreakdown"] = [
    { kind: "materials", cents: -500 },
    { kind: "fuel", cents: 2000 },
    { kind: "payroll", cents: 0 },
  ];
  const report = { costs: 1500, costBreakdown: rows } as AccountingMargin;
  const grouped = marginBreakdown(report);
  assert.equal(
    grouped.reduce((sum, row) => sum + row.cents, 0),
    report.costs,
  );
  assert.equal(grouped[0].kind, "fuel");
  assert.equal(grouped[1].cents, -500);
  assert.equal(rows[0].kind, "materials");
  assert.equal(rows.length, 3);
});
