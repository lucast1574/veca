export const homeSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://veca.com.pe/#organization",
      name: "Vidrios VECA",
      alternateName: "VECA",
      url: "https://veca.com.pe/",
      logo: {
        "@type": "ImageObject",
        url: "https://veca.com.pe/assets/logo.svg",
      },
      description:
        "Instalación de ventanas, mamparas y fachadas de vidrio en Lima y provincias.",
      areaServed: "Lima y provincias del Perú",
      telephone: "+51908917621",
      contactPoint: {
        "@type": "ContactPoint",
        telephone: "+51908917621",
        contactType: "customer service",
        availableLanguage: "Spanish",
        url: "https://wa.me/51908917621",
        areaServed: "Lima y provincias del Perú",
      },
    },
    {
      "@type": "WebSite",
      "@id": "https://veca.com.pe/#website",
      url: "https://veca.com.pe/",
      name: "Vidrios VECA",
      alternateName: "VECA",
      inLanguage: "es-PE",
      publisher: { "@id": "https://veca.com.pe/#organization" },
    },
    {
      "@type": "WebPage",
      "@id": "https://veca.com.pe/#webpage",
      url: "https://veca.com.pe/",
      name: "Vidrios VECA | Instalaciones en Lima y provincias",
      isPartOf: { "@id": "https://veca.com.pe/#website" },
      about: { "@id": "https://veca.com.pe/#organization" },
      inLanguage: "es-PE",
    },
  ],
};
