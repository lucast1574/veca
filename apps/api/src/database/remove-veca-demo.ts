import { type Db, ObjectId } from "mongodb";

const ledger = "data_migrations";
const migration = "remove-veca-demo-2026-11";
const leadIds = ["6b03375985ff0b8ccf118117", "6b03376d85ff0b8ccf118118"];
const guideIds = ["de0000000000000000000001", "de0000000000000000000002"].map(
  (id) => new ObjectId(id),
);

type Totals = {
  leads: number;
  dispatches: number;
  files: number;
  invoices: number;
};
type Cleanup = Totals & { _id: string; blocked: number; checkedAt: string };

const demoLead = {
  $or: [
    {
      _id: { $in: leadIds.map((id) => new ObjectId(id)) },
      name: /^\[demo\]/i,
      email: /\.invalid$/i,
    },
    { source: "manual", name: /^\[demo\]/i, email: /\.invalid$/i },
  ],
};
const safeDispatch = {
  demo: true,
  status: { $in: ["draft", "review", "returned", "rejected"] },
  $and: [
    { $or: [{ externalId: { $exists: false } }, { externalId: "" }] },
    { $or: [{ guideNumber: { $exists: false } }, { guideNumber: "" }] },
    { departedAt: { $exists: false } },
  ],
};

export async function removeVecaDemo(db: Db) {
  const previous = await db
    .collection<Cleanup>(ledger)
    .findOne({ _id: migration });
  if (previous && !previous.blocked)
    return {
      leads: 0,
      dispatches: 0,
      files: 0,
      invoices: 0,
      plans: 0,
      blocked: 0,
    };
  const leads = db.collection("crm_leads");
  const dispatches = db.collection("dispatches");
  const candidates = await leads
    .find(demoLead)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const matches = new Set(candidates.map((row) => row._id.toHexString()));
  const orphans = await leads
    .find({ _id: { $in: leadIds.map((id) => new ObjectId(id)) } })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const present = new Set(orphans.map((row) => row._id.toHexString()));

  const verified: string[] = [];
  let blocked = 0;
  for (const id of matches) {
    const linked = { leadId: id };
    const protectedRecords = await Promise.all([
      dispatches.findOne(
        { ...linked, $nor: [safeDispatch] },
        { projection: { _id: 1 } },
      ),
      db
        .collection("accounting_invoices")
        .findOne({ workId: id }, { projection: { _id: 1 } }),
      db
        .collection("accounting_costs")
        .findOne({ "allocations.workId": id }, { projection: { _id: 1 } }),
      db
        .collection("warehouse_purchases")
        .findOne({ workId: id }, { projection: { _id: 1 } }),
      db
        .collection("warehouse_equipment")
        .findOne({ "assignment.workId": id }, { projection: { _id: 1 } }),
      db
        .collection("inventory_movements")
        .findOne(linked, { projection: { _id: 1 } }),
      db.collection("inventory_materials").findOne(
        {
          $or: [
            { [`workStock.${id}`]: { $exists: true } },
            { "pending.leadId": id },
          ],
        },
        { projection: { _id: 1 } },
      ),
    ]);
    if (protectedRecords.some(Boolean)) blocked++;
    else verified.push(id);
  }

  const linked = { leadId: { $in: verified } };
  const knownOrphans = leadIds.filter((id) => !present.has(id));
  const [guides, files, plans, invoices] = await Promise.all([
    dispatches.deleteMany({
      ...safeDispatch,
      $or: [linked, { _id: { $in: guideIds }, leadId: { $in: knownOrphans } }],
    }),
    db.collection("crm_files").deleteMany(linked),
    db
      .collection("warehouse_plans")
      .deleteMany({ _id: { $in: verified.map((id) => new ObjectId(id)) } }),
    // The dedicated collection only stores invoices issued in the test environment.
    db.collection<{ _id: string }>("demo_invoices").deleteMany({}),
  ]);
  const deleted = await leads.deleteMany({
    $and: [demoLead, { _id: { $in: verified.map((id) => new ObjectId(id)) } }],
  });
  await db.collection<Cleanup>(ledger).updateOne(
    { _id: migration },
    {
      $inc: {
        leads: deleted.deletedCount,
        dispatches: guides.deletedCount,
        files: files.deletedCount,
        invoices: invoices.deletedCount,
      },
      $set: { blocked, checkedAt: new Date().toISOString() },
    },
    { upsert: true },
  );
  return {
    leads: deleted.deletedCount,
    dispatches: guides.deletedCount,
    files: files.deletedCount,
    invoices: invoices.deletedCount,
    plans: plans.deletedCount,
    blocked,
  };
}

export async function vecaDemoReport(db: Db) {
  const [record, leads, dispatches, invoices] = await Promise.all([
    db.collection<Cleanup>(ledger).findOne({ _id: migration }),
    db.collection("crm_leads").countDocuments(demoLead),
    db.collection("dispatches").countDocuments({ demo: true }),
    db.collection("demo_invoices").countDocuments(),
  ]);
  return {
    deleted: record && {
      leads: record.leads,
      dispatches: record.dispatches,
      files: record.files,
      invoices: record.invoices,
      blocked: record.blocked,
    },
    remaining: { leads, dispatches, invoices },
  };
}
