import type { Project } from "./index.js";
export type CompletedWorkSource = {
  id: string;
  version: number;
  name: string;
  location: string;
  completedAt: string | null;
  plan: string;
  result: string;
  project?: Pick<Project, "id" | "title" | "status">;
};
export type WorkSourcePhoto = {
  id: string;
  url: string;
  caption: string;
  tags: string[];
};
export type WorkProjectSource = {
  work: CompletedWorkSource;
  photos: WorkSourcePhoto[];
};
