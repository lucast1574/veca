export const PERU_PROJECT_LOCATIONS = {
  "Lima Metropolitana": [
    "Ancón",
    "Ate",
    "Barranco",
    "Breña",
    "Carabayllo",
    "Chaclacayo",
    "Chorrillos",
    "Cieneguilla",
    "Comas",
    "El Agustino",
    "Independencia",
    "Jesús María",
    "La Molina",
    "La Victoria",
    "Lima (Cercado)",
    "Lince",
    "Los Olivos",
    "Lurigancho-Chosica",
    "Lurín",
    "Magdalena del Mar",
    "Miraflores",
    "Pachacámac",
    "Pucusana",
    "Pueblo Libre",
    "Puente Piedra",
    "Punta Hermosa",
    "Punta Negra",
    "Rímac",
    "San Bartolo",
    "San Borja",
    "San Isidro",
    "San Juan de Lurigancho",
    "San Juan de Miraflores",
    "San Luis",
    "San Martín de Porres",
    "San Miguel",
    "Santa Anita",
    "Santa María del Mar",
    "Santa Rosa",
    "Santiago de Surco",
    "Surquillo",
    "Villa El Salvador",
    "Villa María del Triunfo",
  ],
  Callao: [
    "Bellavista",
    "Callao (Cercado)",
    "Carmen de la Legua Reynoso",
    "La Perla",
    "La Punta",
    "Mi Perú",
    "Ventanilla",
  ],
  "Lima Provincias": [
    "Barranca",
    "Cajatambo",
    "Canta",
    "Cañete",
    "Huaral",
    "Huarochirí",
    "Huaura",
    "Huacho",
    "Mala",
    "Oyón",
    "Yauyos",
  ],
  Amazonas: ["Bagua", "Chachapoyas"],
  Áncash: ["Chimbote", "Huaraz", "Nuevo Chimbote"],
  Apurímac: ["Abancay", "Andahuaylas"],
  Arequipa: ["Arequipa", "Cayma", "Cerro Colorado", "Yanahuara"],
  Ayacucho: ["Ayacucho", "Huamanga", "Huanta"],
  Cajamarca: ["Cajamarca", "Jaén"],
  Cusco: ["Cusco", "San Sebastián", "Santiago", "Urubamba", "Wanchaq"],
  Huancavelica: ["Huancavelica"],
  Huánuco: ["Huánuco", "Tingo María"],
  Ica: ["Chincha Alta", "Ica", "Nazca", "Paracas", "Pisco"],
  Junín: ["Chanchamayo", "Huancayo", "Jauja", "La Merced", "Satipo", "Tarma"],
  "La Libertad": ["Huanchaco", "Trujillo", "Víctor Larco Herrera"],
  Lambayeque: ["Chiclayo", "Lambayeque", "Pimentel"],
  Loreto: ["Iquitos", "Nauta", "Yurimaguas"],
  "Madre de Dios": ["Puerto Maldonado"],
  Moquegua: ["Ilo", "Moquegua"],
  Pasco: ["Cerro de Pasco", "Oxapampa"],
  Piura: ["Máncora", "Paita", "Piura", "Sullana", "Talara"],
  Puno: ["Juliaca", "Puno"],
  "San Martín": ["Moyobamba", "Rioja", "Tarapoto"],
  Tacna: ["Tacna"],
  Tumbes: ["Tumbes", "Zorritos"],
  Ucayali: ["Pucallpa"],
} as const;

export type PeruLocationRegion = keyof typeof PERU_PROJECT_LOCATIONS;

export const locationKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function regionName(region: PeruLocationRegion) {
  return region.startsWith("Lima ") ? "Lima" : region;
}

export function formatPeruLocation(
  region: PeruLocationRegion,
  locality?: string,
) {
  return locality ? `${locality}, ${regionName(region)}` : region;
}

export function matchPeruLocation(value: string) {
  const key = locationKey(value);
  const regions = Object.keys(PERU_PROJECT_LOCATIONS) as PeruLocationRegion[];
  // The explicit locality disambiguates names shared by neighboring areas.
  for (const region of regions) {
    for (const locality of PERU_PROJECT_LOCATIONS[region]) {
      if (key === locationKey(formatPeruLocation(region, locality))) {
        return { region, locality };
      }
    }
  }
  const region = regions.find(
    (candidate) =>
      key === locationKey(candidate) ||
      key === locationKey(regionName(candidate)),
  );
  return region ? { region, locality: "" } : null;
}
