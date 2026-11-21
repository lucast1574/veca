import { ObjectId, type Db } from "mongodb";
import { config } from "../common/config";

export async function provisionMobileReview(db: Db) {
  const users = db.collection("users");
  const accounts = [
    [
      "review-google-play",
      "Revisión Google Play",
      config.MOBILE_REVIEW_GOOGLE_HASH,
    ],
    ["review-app-store", "Revisión App Store", config.MOBILE_REVIEW_APPLE_HASH],
  ] as const;
  for (const [username, name, passwordHash] of accounts) {
    if (!passwordHash) continue;
    if (!passwordHash.startsWith("$argon2id$"))
      throw new Error("Invalid mobile review password hash");
    await users.updateOne(
      { username, mobileReview: true },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          username,
          name,
          passwordHash,
          role: null,
          mobileReview: true,
          provider: "password",
          emailVerified: true,
          status: "active",
          revision: 1,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
