import type { ObjectId } from "mongodb";
import type { ProjectInput, Project } from "@veca/content";
import type { SocialChannel } from "@veca/content";
export interface ProjectDocument {
  _id: ObjectId;
  slug: string;
  draft: ProjectInput;
  published: Project | null;
  sourceWork?: Project["sourceWork"];
  sourceOperationId?: string;
  sourceOperationHash?: string;
  publishedVersion?: number | null;
  firstPublishedAt?: string | null;
  socialShare?: {
    queuedAt: string;
    publishedVersion: number;
    channels?: Partial<
      Record<
        SocialChannel,
        {
          claim: string;
          state: "processing" | "published" | "review" | "retry";
          at: string;
          nextAt?: string;
          reason?: string;
        }
      >
    >;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}
