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
@Module({
  imports: [AuthModule],
  controllers: [
    ProjectsController,
    PublicProjectsController,
    SocialDeliveryController,
  ],
  providers: [ProjectsService, ProjectsRepository, LandingProjectsService],
})
export class ProjectsModule {}
