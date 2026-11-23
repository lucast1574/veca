import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  INITIAL_LANDING_SHOWCASE,
  LANDING_FIXED_PROJECTS,
  LANDING_PLACEMENT_IDS,
  initialLandingProjects,
  type LandingContent,
  type LandingPlacementId,
  type LandingPlacements,
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
  placements?: LandingPlacements<ObjectId | null>;
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
    if (!ids.length) return [];
    const docs = await this.repository.collection
      .find({ _id: { $in: ids } })
      .toArray();
    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
    return ids.flatMap((id) => byId.get(String(id)) ?? []);
  }

  private async resolvePlacements(
    overrides: LandingSelectionDocument["placements"] = {},
  ) {
    const collection = this.repository.collection;
    const fixedSlugs: LandingPlacements<string> = LANDING_FIXED_PROJECTS;
    const explicitIds = Object.values(overrides).filter((id) => id !== null);
    const automatic = LANDING_PLACEMENT_IDS.filter(
      (slot) => overrides[slot] === undefined,
    );
    const slugs = automatic.flatMap((slot) => fixedSlugs[slot] ?? []);
    const solutions = automatic.filter((slot) => !fixedSlugs[slot]);
    const [explicit, fixed, examples] = await Promise.all([
      this.selectedProjects(explicitIds),
      slugs.length
        ? collection
            .find({ slug: { $in: slugs }, published: { $ne: null } })
            .toArray()
        : [],
      solutions.length
        ? collection
            .aggregate<{
              _id: LandingPlacementId;
              project: ProjectDocument;
            }>([
              { $match: { "published.solutionSlot": { $in: solutions } } },
              { $sort: { "published.updatedAt": -1, _id: -1 } },
              {
                $group: {
                  _id: "$published.solutionSlot",
                  project: { $first: "$$ROOT" },
                },
              },
            ])
            .toArray()
        : [],
    ]);
    const byId = new Map(explicit.map((doc) => [String(doc._id), doc]));
    const bySlug = new Map(fixed.map((doc) => [doc.slug, doc]));
    const bySolution = new Map(
      examples.map(({ _id, project }) => [_id, project]),
    );
    return LANDING_PLACEMENT_IDS.map((slot) => {
      const override = overrides[slot];
      const slug = fixedSlugs[slot];
      const project =
        override !== undefined
          ? byId.get(String(override))
          : slug
            ? bySlug.get(slug)
            : bySolution.get(slot);
      return { slot, automatic: override === undefined, project };
    });
  }

  private async carousel(saved: LandingSelectionDocument | null) {
    if (!saved) return this.initialProjects();
    return (await this.selectedProjects(saved.projectIds)).flatMap(
      ({ published }) => published ?? [],
    );
  }

  async publicList(): Promise<Project[]> {
    return this.carousel(await this.selections.findOne({ _id: "carousel" }));
  }

  async publicContent(): Promise<LandingContent> {
    const saved = await this.selections.findOne({ _id: "carousel" });
    const [carousel, placements] = await Promise.all([
      this.carousel(saved),
      this.resolvePlacements(saved?.placements),
    ]);
    return {
      carousel,
      projects: Object.fromEntries(
        placements.flatMap(({ slot, project }) =>
          project?.published ? [[slot, project.published]] : [],
        ),
      ),
    };
  }

  private async placementSelection(
    overrides: LandingSelectionDocument["placements"],
  ) {
    const placements = await this.resolvePlacements(overrides);
    const selection: LandingProjectSelection["placements"] = {};
    for (const { slot, automatic, project } of placements) {
      selection[slot] = {
        automatic,
        project: project ? selectionItem(project) : null,
      };
    }
    return selection;
  }

  async getSelection(): Promise<LandingProjectSelection> {
    const saved = await this.selections.findOne({ _id: "carousel" });
    const [items, placements] = await Promise.all([
      saved
        ? this.selectedProjects(saved.projectIds).then((docs) =>
            docs.map(selectionItem),
          )
        : this.initialProjects().then((projects) =>
            projects.map(({ id, title }) => ({ id, title, published: true })),
          ),
      this.placementSelection(saved?.placements),
    ]);
    return { revision: saved?.revision ?? 0, items, placements };
  }

  async saveSelection(
    revision: number,
    ids: string[],
    input?: LandingPlacements<string | null>,
    expected?: LandingPlacements<string | null>,
    expectedProjectIds?: string[],
  ): Promise<LandingProjectSelection> {
    const conflict = () =>
      new ConflictException(
        "Otra persona actualizó la portada. Cierra y vuelve a abrir la selección.",
      );
    const current = await this.selections.findOne({ _id: "carousel" });
    if (revision !== (current?.revision ?? 0)) throw conflict();
    if (expectedProjectIds && !current) {
      const before = (await this.initialProjects()).map(({ id }) => id);
      if (
        before.length !== expectedProjectIds.length ||
        before.some((id, index) => id !== expectedProjectIds[index])
      )
        throw conflict();
    }
    if (expected && Object.keys(expected).length) {
      const before = await this.placementSelection(current?.placements);
      if (
        LANDING_PLACEMENT_IDS.some(
          (slot) =>
            expected[slot] !== undefined &&
            (before[slot]?.project?.id ?? null) !== expected[slot],
        )
      )
        throw conflict();
    }

    const projectIds = ids.map((id) => new ObjectId(id));
    const placements: LandingSelectionDocument["placements"] =
      input === undefined
        ? current?.placements
        : Object.fromEntries(
            Object.entries(input).map(([slot, id]) => [
              slot,
              id === null ? null : new ObjectId(id),
            ]),
          );
    const [docs, placementSelection] = await Promise.all([
      this.selectedProjects(projectIds),
      this.placementSelection(placements),
    ]);
    const existingIds = new Set(current?.projectIds.map(String));
    if (
      docs.length !== projectIds.length ||
      docs.some((doc) => !doc.published && !existingIds.has(String(doc._id))) ||
      (input &&
        LANDING_PLACEMENT_IDS.some((slot) => {
          const id = input[slot];
          return (
            id &&
            id !== current?.placements?.[slot]?.toHexString() &&
            !placementSelection[slot]?.project?.published
          );
        }))
    ) {
      throw new BadRequestException(
        "Solo puedes agregar proyectos publicados.",
      );
    }

    if (current) {
      const result = await this.selections.updateOne(
        { _id: "carousel", revision },
        {
          $set: { projectIds, ...(placements && { placements }) },
          $inc: { revision: 1 },
        },
      );
      if (!result.matchedCount) throw conflict();
    } else {
      try {
        await this.selections.insertOne({
          _id: "carousel",
          revision: 1,
          projectIds,
          ...(placements && { placements }),
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
      placements: placementSelection,
    };
  }
}
