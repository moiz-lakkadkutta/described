# fire tv catalog integration is partner only

Task attempted: DESC-008 — make Described's titles appear in Fire TV search and "Alexa, play Sintel on Described", and in Continue watching.
Steps:
  1. Searched Amazon's docs for the Fire OS equivalent of Vega's Content Launcher.
  2. Found catalog integration (CDF, now EMBER) and the Fire TV Integration SDK for content personalization.
Expected: a self-serve path for a new app — upload a catalog in the developer console, or a runtime API like Vega's Content Launcher.
Actual: "Catalog Integration is available to select partners only"; CDF "isn't supported for new integrations" (use EMBER); content personalization requires catalog integration and a jar plus "your Amazon contact" for supported devices. A hackathon entry cannot be discovered by voice or search, and cannot reach Continue watching, on Fire OS. The docs were also unreachable from our cloud build environment (developer.amazon.com blocked by its egress proxy), so the CDF draft feed could not be checked against the XSD.
Severity: Medium — no workaround inside the app; discovery features depend on Amazon accepting us.
Workaround: draft feed at GET /catalog/fire-tv.xml and described:// deep links ready; ask at submission.
Suggestion: a self-serve catalog tier for small Appstore apps (even a capped number of titles), or Vega's Content Launcher on Fire OS too; publish the EMBER XSD without a partner login.
Environment: Fire OS 7, Amazon developer docs as of 2026-10-01
Links: https://developer.amazon.com/docs/catalog/ember-catalog-integration-overview.html · https://developer.amazon.com/docs/fire-tv/introduction-content-personalization.html · docs/platform/fire-os-bindings.md §1, §3
