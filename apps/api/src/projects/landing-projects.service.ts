import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  INITIAL_LANDING_SHOWCASE,
  initialLandingProjects,
  type LandingProjectSelection,
  type Project,
} from "@veca/content";
import { MongoServerError, ObjectId } from "mongodb";
import { Database } from "../database/database.module";
import type { ProjectDocument } from "./project.document";
import { ProjectsRepository } from "./projects.repository";
import { ProjectsService } from "./projects.service";

type LandingSelectionDocument = {
  _id: "carousel";
  revision: number;
  projectIds: ObjectId[];
};

function selectionItem(doc: ProjectDocument) {
  return {
    id: String(doc._id),
    title: doc.published?.title ?? doc.draft.title,
    published: !!doc.published,
  };
}

@Injectable()
export class LandingProjectsService {
  constructor(
    private readonly database: Database,
    private readonly repository: ProjectsRepository,
    private readonly projects: ProjectsService,
  ) {}

  private get selections() {
    return this.database.db.collection<LandingSelectionDocument>(
      "landing_projects",
    );
  }

  private async initialProjects() {
    const [featured, showcase] = await Promise.all([
      this.projects.publicList("", "", true, 1),
      this.repository.collection
        .find({
          slug: { $in: INITIAL_LANDING_SHOWCASE },
          published: { $ne: null },
        })
        .toArray(),
    ]);
    const bySlug = new Map(
      showcase.map(({ slug, published }) => [slug, published]),
    );
    return initialLandingProjects(
      featured.items,
      INITIAL_LANDING_SHOWCASE.map((slug) => bySlug.get(slug) ?? null),
    );
  }

  private async selectedProjects(ids: ObjectId[]) {
    const docs = await this.repository.collection
      .find({ _id: { $in: ids } })
      .toArray();
    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
    return ids.flatMap((id) => byId.get(String(id)) ?? []);
  }

  async publicList(): Promise<Project[]> {
    const saved = await this.selections.findOne({ _id: "carousel" });
    if (!saved) return this.initialProjects();
    return (await this.selectedProjects(saved.projectIds)).flatMap(
      ({ published }) => published ?? [],
    );
  }

  async getSelection(): Promise<LandingProjectSelection> {
    const saved = await this.selections.findOne({ _id: "carousel" });
    if (!saved) {
      const projects = await this.initialProjects();
      return {
        revision: 0,
        items: projects.map(({ id, title }) => ({
          id,
          title,
          published: true,
        })),
      };
    }
    return {
      revision: saved.revision,
      items: (await this.selectedProjects(saved.projectIds)).map(selectionItem),
    };
  }

  async saveSelection(
    revision: number,
    ids: string[],
  ): Promise<LandingProjectSelection> {
    const conflict = () =>
      new ConflictException(
        "Otra persona actualizó la portada. Cierra y vuelve a abrir la selección.",
      );
    const current = await this.selections.findOne({ _id: "carousel" });
    if (revision !== (current?.revision ?? 0)) throw conflict();

    const projectIds = ids.map((id) => new ObjectId(id));
    const docs = await this.selectedProjects(projectIds);
    const existingIds = new Set(current?.projectIds.map(String));
    if (
      docs.length !== projectIds.length ||
      docs.some((doc) => !doc.published && !existingIds.has(String(doc._id)))
    ) {
      throw new BadRequestException(
        "Solo puedes agregar proyectos publicados.",
      );
    }

    if (current) {
      const result = await this.selections.updateOne(
        { _id: "carousel", revision },
        { $set: { projectIds }, $inc: { revision: 1 } },
      );
      if (!result.matchedCount) throw conflict();
    } else {
      try {
        await this.selections.insertOne({
          _id: "carousel",
          revision: 1,
          projectIds,
        });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000)
          throw conflict();
        throw error;
      }
    }
    return {
      revision: revision + 1,
      items: docs.map(selectionItem),
    };
  }
}
