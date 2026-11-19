import type { Project } from "@veca/content";

// These landscape photographs show the same projects at a higher resolution.
const landscapeImages = new Map([
  ["6afe78a9c9ce4c95092a4d70", "6afe78a9c9ce4c95092a4d72"], // Tribeca I
  ["6afe84452b79ec6d83882ba9", "6afe84462b79ec6d83882bac"], // Onix
  ["6afe84652b79ec6d83882bae", "6afe84662b79ec6d83882bb0"], // ibis Miraflores
  ["6afe847a2b79ec6d83882bb2", "6afe847c2b79ec6d83882bbc"], // Madre Selva
]);

export function withHomeCover(project: Project): Project {
  const imageId = project.coverId && landscapeImages.get(project.coverId);
  if (imageId && project.images.some((image) => image.id === imageId)) {
    return { ...project, coverId: imageId };
  }
  return project;
}
