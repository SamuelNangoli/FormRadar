export const FOOTBALL_PROVIDER = "football-data.org";

// Public media only. Never accept credentials, arbitrary hosts or image proxies.
export function safeFootballImageUrl(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== "https://crests.football-data.org" ||
      url.username || url.password || url.search || url.hash ||
      !/^\/[a-z0-9_-]+\.(?:svg|png|webp|jpe?g)$/i.test(url.pathname)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function entityImage(entity, kind) {
  if (
    entity?.provider !== FOOTBALL_PROVIDER ||
    !Number.isInteger(entity.id) || entity.id <= 0
  ) return null;
  return safeFootballImageUrl(kind === "competition" ? entity.emblem : entity.crest);
}
