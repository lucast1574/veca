import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import {
  CATEGORIES,
  LANDING_PLACEMENT_IDS,
  LANDING_PROJECT_LIMIT,
  TAGS,
} from "@veca/content";
import { PublicEndpoint, RequirePermission } from "../auth/route-access";
import { ProjectsService } from "./projects.service";
import { LandingProjectsService } from "./landing-projects.service";
import { parse } from "../common/validation";
const versionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
const publishSchema = versionSchema.extend({
  // Accept requests from panels opened before automatic sharing was enabled.
  shareOnSocial: z.boolean().optional(),
});
const projectId = z.string().regex(/^[a-f0-9]{24}$/);
const landingSelectionSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    projectIds: z
      .array(projectId)
      .max(LANDING_PROJECT_LIMIT)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Hay proyectos duplicados.",
      ),
    expectedProjectIds: z
      .array(projectId)
      .max(LANDING_PROJECT_LIMIT)
      .optional(),
    expectedPlacements: z
      .partialRecord(z.enum(LANDING_PLACEMENT_IDS), projectId.nullable())
      .optional(),
    placements: z
      .partialRecord(z.enum(LANDING_PLACEMENT_IDS), projectId.nullable())
      .optional(),
  })
  .strict();
@Controller("admin/projects")
@RequirePermission("projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly landing: LandingProjectsService,
  ) {}
  @Get() list() {
    return this.projects.list();
  }
  @Get("landing") landingSelection() {
    return this.landing.getSelection();
  }
  @Put("landing") saveLandingSelection(@Body() input: unknown) {
    const {
      revision,
      projectIds,
      placements,
      expectedPlacements,
      expectedProjectIds,
    } = parse(landingSelectionSchema, input);
    return this.landing.saveSelection(
      revision,
      projectIds,
      placements,
      expectedPlacements,
      expectedProjectIds,
    );
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.projects.get(id);
  }
  @Post() create(@Body() input: unknown) {
    return this.projects.create(input);
  }
  @Put(":id") save(@Param("id") id: string, @Body() input: unknown) {
    return this.projects.save(id, input);
  }
  @Post(":id/publish") publish(
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.projects.publish(id, parse(publishSchema, input).version);
  }
  @Post(":id/unpublish") unpublish(
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return this.projects.unpublish(id, parse(versionSchema, input).version);
  }
}
@Controller("public")
export class PublicProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly landing: LandingProjectsService,
  ) {}
  @PublicEndpoint()
  @Get("landing-content")
  landingContent() {
    return this.landing.publicContent();
  }
  @PublicEndpoint()
  @Get("landing-projects")
  landingProjects() {
    return this.landing.publicList();
  }
  @PublicEndpoint()
  @Get("taxonomy")
  taxonomy() {
    return { categories: CATEGORIES, tags: TAGS };
  }
  @PublicEndpoint()
  @Get("projects")
  list(@Query() input: unknown) {
    const q = parse(
      z.object({
        q: z.string().max(120).default(""),
        category: z.string().max(50).default(""),
        featured: z.enum(["true", "false"]).default("false"),
        solutionSlot: z
          .enum(["", "viviendas", "edificios", "interiores", "remodelaciones"])
          .default(""),
        tag: z.enum(["", ...TAGS]).default(""),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      }),
      input,
    );
    return this.projects.publicList(
      q.q,
      q.category,
      q.featured === "true",
      q.page,
      q.solutionSlot,
      q.tag,
    );
  }
  @PublicEndpoint()
  @Get("sitemap")
  sitemap() {
    return this.projects.sitemap();
  }
  @PublicEndpoint()
  @Get("projects/:slug")
  get(@Param("slug") slug: string) {
    return this.projects.publicOne(slug);
  }
}
