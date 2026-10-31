// Client-safe marketing constants — NO db import (so the /marketing client can
// use them without dragging pg into the browser bundle).

export type DraftKind = "social" | "blog";

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  social: "Social post",
  blog: "Blog post",
};

/** Where an approved social post can go. The posting agent signs in to each
 *  through the browser Joe signed in himself (lib/publisher/core.ts). */
export type PostPlatform = "facebook" | "instagram" | "google_business";

export const POST_PLATFORMS: PostPlatform[] = ["facebook", "instagram", "google_business"];

export const POST_PLATFORM_LABEL: Record<PostPlatform, string> = {
  facebook: "Facebook page",
  instagram: "Instagram",
  google_business: "Google Business Profile",
};

export function isPostPlatform(v: unknown): v is PostPlatform {
  return typeof v === "string" && (POST_PLATFORMS as string[]).includes(v);
}

/** What each platform takes (checked when Joe asks to approve, so the card
 *  never covers a post the site would refuse). */
export const POST_LIMITS: Record<PostPlatform, { maxChars: number; maxPhotos: number; needsPhoto: boolean }> = {
  facebook: { maxChars: 5000, maxPhotos: 10, needsPhoto: false },
  instagram: { maxChars: 2200, maxPhotos: 10, needsPhoto: true },
  google_business: { maxChars: 1500, maxPhotos: 1, needsPhoto: false },
};

/** Why this post can't go to this platform as it stands, or null. */
export function postProblem(platform: PostPlatform, body: string, photoCount: number): string | null {
  const lim = POST_LIMITS[platform];
  const label = POST_PLATFORM_LABEL[platform];
  if (!body.trim()) return "The post has no text.";
  if (body.length > lim.maxChars) return `${label} takes up to ${lim.maxChars} characters; this post has ${body.length}.`;
  if (lim.needsPhoto && photoCount === 0) return `${label} needs at least one photo.`;
  if (photoCount > lim.maxPhotos) return `${label} takes up to ${lim.maxPhotos} photo${lim.maxPhotos === 1 ? "" : "s"}; ${photoCount} are picked.`;
  if (platform === "instagram" && (body.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0) > 30) return "Instagram takes up to 30 hashtags.";
  return null;
}
