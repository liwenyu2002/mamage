// Share links stay on the current intranet origin. No public-domain fallback or token handoff.
export function publicEntryUrl() {
  return window.location.origin;
}
