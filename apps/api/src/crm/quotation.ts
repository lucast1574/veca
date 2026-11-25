import { ObjectId, type Db } from "mongodb";
import type { WorkQuotation } from "@veca/content";
import type { AttachmentDocument } from "./crm.files";

/** The latest structured quotation is the single source for planning amounts. */
export async function latestQuotation(
  db: Db,
  leadId: string,
): Promise<WorkQuotation | undefined> {
  leadId = new ObjectId(leadId).toHexString();
  const row = await db
    .collection<AttachmentDocument>("crm_files")
    .findOne(
      { leadId, type: "quotation", quotation: { $exists: true } },
      { sort: { createdAt: -1, _id: -1 } },
    );
  return row?.quotation
    ? {
        ...row.quotation,
        attachmentId: String(row._id),
        createdAt: row.createdAt,
      }
    : undefined;
}
