# fire tv recommendations retired may 2025 docs 404 only on wayback

Task attempted: DESC-035 — a third Fire TV platform integration: post Described's titles as Fire TV Recommendations (the "Recommended by your apps" row on the Fire TV home screen), the one discovery path that looked self-serve after catalog integration turned out to be partner-only (friction 2026-10-01).
Steps:
  1. Opened Amazon's Fire TV Recommendations docs (https://developer.amazon.com/docs/fire-tv/recommendations-overview.html).
  2. Searched developer.amazon.com for a replacement; looked at Content Personalization (Fire TV Integration SDK).
Expected: a documented, supported API for an app to put rows or cards on the Fire TV home screen.
Actual: Fire TV Recommendations was retired by Amazon in May 2025. The doc pages return HTTP 404 (checked 2026-10-15 with curl); only the Wayback Machine still has them. Content Personalization is partner-only (it needs catalog integration). There is no self-serve home-screen integration left for a new Fire OS app.
Severity: Medium — about an hour lost; it removed the integration we had planned as number 3 for the "≥ 3 Fire TV integrations" requirement.
Workaround: re-scoped DESC-035 to two integrations that need no partnership: captions follow the viewer's Fire TV caption settings (Android CaptioningManager), and VoiceView support documented as an integration (docs/platform/fire-os-bindings.md §5–§6).
Suggestion: when a Fire TV API is retired, keep the doc URL alive with a retirement notice and the replacement (or "none"), and say on the Content Personalization page which parts, if any, are open to apps without catalog integration.
Environment: Fire OS 7 (AFTSS), Amazon developer docs as of 2026-10-15
Links: https://developer.amazon.com/docs/fire-tv/recommendations-overview.html (404) · https://web.archive.org/web/2024/https://developer.amazon.com/docs/fire-tv/recommendations-overview.html · https://developer.amazon.com/docs/fire-tv/introduction-content-personalization.html · docs/friction/2026-10-01-fire-tv-catalog-integration-is-partner-only.md
