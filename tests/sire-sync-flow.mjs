import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27099";
process.env.MONGODB_DATABASE = "veca_qa";
const { SireSyncService } =
  await import("../apps/api/dist/accounting/sire-sync.service.js");
const client = await new MongoClient("mongodb://127.0.0.1:27099").connect();
const db = client.db("veca_qa");
const period = "2020-01";
const states = db.collection("sire_purchase_syncs");
let calls = 0,
  complete = false,
  fail = false;
const provider = {
  automatic: async (month, book, job) => {
    calls++;
    assert.equal(month, period);
    assert.equal(book, "purchases");
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (fail) throw Error("Provider unavailable");
    if (!complete) return { status: "pending", job: "qa-persisted-job" };
    assert.equal(job, "qa-persisted-job");
    await states.updateOne(
      { _id: period },
      { $set: { syncedAt: new Date().toISOString() } },
    );
    return { status: "ready" };
  },
};
const first = new SireSyncService({ db }, provider),
  second = new SireSyncService({ db }, provider);
try {
  await states.deleteOne({ _id: period });
  await Promise.all([first.sync(period), second.sync(period)]);
  assert.equal(calls, 1, "one worker owns a period while the other waits");
  assert.equal((await states.findOne({ _id: period })).job, "qa-persisted-job");
  complete = true;
  await second.sync(period);
  assert.equal(calls, 2);
  assert.equal((await states.findOne({ _id: period })).job, undefined);
  await first.sync(period);
  assert.equal(
    calls,
    2,
    "freshly completed periods wait for the next interval",
  );
  await states.updateOne(
    { _id: period },
    {
      $unset: { syncedAt: "" },
      $set: {
        job: "qa-persisted-job",
        lockUntil: new Date(Date.now() - 1000),
        lease: "stopped-worker",
      },
    },
  );
  fail = true;
  await second.sync(period);
  assert.equal(calls, 3);
  const failed = await states.findOne({ _id: period });
  assert.equal(failed.failed, true);
  assert.equal(failed.job, "qa-persisted-job");
  assert.ok(failed.retryAt > new Date());
  assert.equal(failed.lockUntil, undefined);
  await first.sync(period);
  assert.equal(calls, 3, "outages use a backoff without losing the job");
  console.log(
    "PASS automatic sync: multi-worker lease, job persistence/resume, refresh interval, expired lease recovery and outage backoff.",
  );
} finally {
  await states.deleteOne({ _id: period });
  await client.close();
}
