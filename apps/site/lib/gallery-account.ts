import type { GoogleConfiguration } from "./google";

export async function galleryRequest<T>(
  base: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, base), {
    cache: "no-store",
    credentials: "omit",
    ...(data !== undefined && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof result?.message === "string"
        ? result.message
        : "No pudimos completar la solicitud.",
    );
  }
  return result;
}

export async function confirmGoogle(base: string) {
  const { google } = await galleryRequest<{
    google: GoogleConfiguration | null;
  }>(base, "/auth/config");
  if (!google) throw new Error("El acceso con Google no está disponible.");
  const { googleIdToken } = await import("./google");
  return googleIdToken(google);
}

export const galleryApi =
  process.env.PUBLIC_API_URL || "https://api.veca.com.pe";
