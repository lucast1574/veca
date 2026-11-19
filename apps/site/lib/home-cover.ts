import type { Project } from "@veca/content";

// These landscape photographs show the same projects at a higher resolution.
const landscapeImages = new Map([
  ["6afe78a9c9ce4c95092a4d70", "6afe78a9c9ce4c95092a4d72"], // Tribeca I
  ["6afe84452b79ec6d83882ba9", "6afe84462b79ec6d83882bac"], // Onix
  ["6afe84652b79ec6d83882bae", "6afe84662b79ec6d83882bb0"], // ibis Miraflores
  ["6afe847a2b79ec6d83882bb2", "6afe847c2b79ec6d83882bbc"], // Madre Selva
  ["6afe87af2b79ec6d83882c3a", "6afe87af2b79ec6d83882c3c"], // Oficinas ONU
  ["6afe87922b79ec6d83882c27", "6afe87922b79ec6d83882c28"], // Sarcletti
  ["6afe88102b79ec6d83882c5c", "6afe88112b79ec6d83882c5e"], // Procabell
  ["6afe84dc2b79ec6d83882bcb", "6afe84dc2b79ec6d83882bcc"], // Greenleaf
]);

export function withHomeCover(project: Project): Project {
  const imageId = project.coverId && landscapeImages.get(project.coverId);
  if (imageId && project.images.some((image) => image.id === imageId)) {
    return { ...project, coverId: imageId };
  }
  return project;
}
