import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import {
  ProjectsController,
  PublicProjectsController,
} from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { LandingProjectsService } from "./landing-projects.service";
import { ProjectsRepository } from "./projects.repository";
import { SocialDeliveryController } from "./social-delivery.controller";
import { MediaModule } from "../media/media.module";
import { WorkProjects, WorkProjectsController } from "./work-projects";
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [
    ProjectsController,
    PublicProjectsController,
    SocialDeliveryController,
    WorkProjectsController,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    LandingProjectsService,
    WorkProjects,
  ],
})
export class ProjectsModule {}
