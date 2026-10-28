/**
 * Only same-site paths are allowed as a post-login destination, so a crafted
 * link (?next=https://evil.example) can't send people to another site.
 */
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 500) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  if (next.startsWith("/login") || next.startsWith("/set-password")) return fallback;
  return next;
}
