import assert from "node:assert/strict";
import { test } from "node:test";
import {
  laborAllocationInput,
  splitLaborCost,
} from "../packages/content/src/labor.ts";

test("preserves full and partial payroll cost to the cent", () => {
  const projectA = "a".repeat(24);
  const projectB = "b".repeat(24);
  const rows = [
    { workId: projectB, basisPoints: 5000 },
    { workId: projectA, basisPoints: 5000 },
  ];
  assert.deepEqual(splitLaborCost(311, rows), [
    { workId: projectA, cents: 156 },
    { workId: projectB, cents: 155 },
  ]);
  assert.deepEqual(splitLaborCost(311, [rows[0]]), [
    { workId: projectB, cents: 156 },
  ]);
  assert.deepEqual(splitLaborCost(311, []), []);
});

test("rejects duplicate works and over-allocation", () => {
  const workId = "ab".repeat(12);
  const input = {
    source: { kind: "fee", id: "5885de5b-c7ba-4571-baa6-955987a079e0" },
    sourceRevision: 0,
    revision: 0,
  };
  assert.equal(
    laborAllocationInput.safeParse({
      ...input,
      rows: [
        { workId, basisPoints: 3000 },
        { workId: workId.toUpperCase(), basisPoints: 3000 },
      ],
    }).success,
    false,
  );
  assert.equal(
    laborAllocationInput.safeParse({
      ...input,
      rows: [
        { workId, basisPoints: 8000 },
        { workId: "bc".repeat(12), basisPoints: 3000 },
      ],
    }).success,
    false,
  );
});
