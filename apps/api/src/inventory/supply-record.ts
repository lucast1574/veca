import type { SupplyRequest } from "@veca/content";
import type { ObjectId } from "mongodb";
export type SupplyOperation = SupplyRequest["operations"][number];
export type SupplyDocument = Omit<SupplyRequest, "id"> & { _id: ObjectId };
