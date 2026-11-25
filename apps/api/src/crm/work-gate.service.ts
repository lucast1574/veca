import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import type { LeadDocument } from "./crm.repository";
import { Database } from "../database/database.module";
type WorkOperationKind =
  | "request"
  | "purchase"
  | "guide"
  | "supply"
  | "movement"
  | "equipment"
  | "departure"
  | "submit"
  | "issue-guide"
  | "cancel-delivery"
  | "guide-request";
export type WorkOperationKey = `${WorkOperationKind}:${string}`;
@Injectable()
export class WorkGate {
  constructor(private readonly db: Database) {}
  async reconcile(id: string) {
    const works = this.db.db.collection<LeadDocument>("crm_leads");
    const row = await works.findOne({ _id: new ObjectId(id) });
    for (const operation of row?.activeOperations || []) {
      const [kind, key] = operation.split(":");
      let confirmed = false;
      if (
        ["request", "purchase", "guide"].includes(kind) &&
        ObjectId.isValid(key)
      ) {
        const collection =
          kind === "request"
            ? "supply_requests"
            : kind === "purchase"
              ? "warehouse_purchases"
              : "dispatches";
        confirmed = !!(await this.db.db.collection(collection).findOne({
          _id: new ObjectId(key),
          [kind === "guide" ? "leadId" : "workId"]: id,
        }));
      }
      if (kind === "guide-request")
        confirmed = !!(await this.db.db
          .collection("dispatches")
          .findOne({
            supplyRequestId: key,
            leadId: id,
            status: { $ne: "draft" },
          }));
      if (kind === "supply" || kind === "cancel-delivery")
        confirmed = !!(await this.db.db.collection("supply_requests").findOne({
          workId: id,
          operations: {
            $elemMatch: {
              operationId: key,
              completed: true,
            },
          },
          "pending.operationId": { $ne: key },
        }));
      if (kind === "movement")
        confirmed = !!(await this.db.db
          .collection<{ _id: string; leadId: string }>("inventory_movements")
          .findOne({ leadId: id, _id: { $regex: ":" + key + "$" } }));
      if (kind === "equipment" && ObjectId.isValid(key))
        confirmed = !!(await this.db.db
          .collection("warehouse_equipment")
          .findOne({
            _id: new ObjectId(key),
            events: { $elemMatch: { operationId: operation, workId: id } },
          }));
      if (kind === "departure" && ObjectId.isValid(key))
        confirmed = !!(await this.db.db.collection("dispatches").findOne({
          _id: new ObjectId(key),
          leadId: id,
          departedAt: { $exists: true },
        }));
      if (["submit", "issue-guide"].includes(kind) && ObjectId.isValid(key)) {
        const expected = Number(operation.split(":")[2]);
        confirmed = !!(await this.db.db.collection("dispatches").findOne({
          _id: new ObjectId(key),
          leadId: id,
          version: { $gt: expected },
        }));
      }
      if (confirmed)
        await works.updateOne(
          { _id: new ObjectId(id) },
          { $pull: { activeOperations: operation } },
        );
    }
  }
  async run<T>(
    id: string,
    operation: WorkOperationKey,
    action: () => Promise<T>,
    allowCompleted = false,
  ): Promise<T> {
    const collection = this.db.db.collection<LeadDocument>("crm_leads");
    const claimed = await collection.updateOne(
      {
        _id: new ObjectId(id),
        ...(allowCompleted ? {} : { stage: { $ne: "completed" } }),
        closingOperation: { $exists: false },
      },
      { $addToSet: { activeOperations: operation } },
    );
    if (!claimed.matchedCount)
      throw new ConflictException(
        "La obra está cerrada o se está comprobando su cierre. Actualiza la ficha.",
      );
    try {
      const result = await action();
      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $pull: { activeOperations: operation } },
      );
      return result;
    } catch (error) {
      // An uncertain database failure retains the durable marker for an exact retry.
      if (error instanceof HttpException)
        await collection.updateOne(
          { _id: new ObjectId(id) },
          { $pull: { activeOperations: operation } },
        );
      throw error;
    }
  }
}
