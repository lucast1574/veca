export function publicationPhotos(includeDrafts: boolean) {
  return [
    {
      $project: {
        publishedIds: { $ifNull: ["$published.images.id", []] },
        versions: [
          {
            content: "$published",
            status: "published",
            date: { $ifNull: ["$published.publishedAt", "$updatedAt"] },
          },
          ...(includeDrafts
            ? [{ content: "$draft", status: "draft", date: "$updatedAt" }]
            : []),
        ],
      },
    },
    { $unwind: "$versions" },
    {
      $unwind: {
        path: "$versions.content.images",
        includeArrayIndex: "position",
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            { $eq: ["$versions.status", "published"] },
            {
              $not: [{ $in: ["$versions.content.images.id", "$publishedIds"] }],
            },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: {
          $concat: [{ $toString: "$_id" }, "/", "$versions.content.images.id"],
        },
        originId: { $toString: "$_id" },
        position: 1,
        source: { $literal: "publication" },
        url: "$versions.content.images.url",
        caption: { $ifNull: ["$versions.content.images.caption", ""] },
        alt: { $ifNull: ["$versions.content.images.alt", ""] },
        createdAt: "$versions.date",
        publication: {
          title: "$versions.content.title",
          location: "$versions.content.location",
          category: "$versions.content.category",
          status: "$versions.status",
          cover: {
            $eq: ["$versions.content.coverId", "$versions.content.images.id"],
          },
          href: "$versions.content.seo.canonical",
        },
      },
    },
  ];
}
