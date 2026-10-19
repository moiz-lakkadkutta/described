# npm publish E403 until 2FA is on for the account

Task attempted: publish vega-media-kit (the open-source player, cue overlay and Fire TV bindings) to npm so Described and the
judges install it from the registry instead of a linked sibling checkout.
Steps:
  1. Created an npm org for the scope, tagged the kit `v0.1.0`, ran `npm publish --access public` from a clean checkout.
  2. npm answered `E403 Forbidden`.
  3. Turned on 2FA (auth and writes), retried with `--otp` from an agent shell that has no TTY.
  4. Settled on the user scope `@moiz0309`, version 0.2.0, published through npm's browser web login (PR #79).
Expected: either a successful first publish, or an error that says "this account needs two-factor authentication to publish".
Actual: npm now requires 2FA (or a granular access token with "bypass 2FA") to publish, and an E403 on a fresh scope
  reads like a scope or org permission problem; the 2FA requirement had to be looked up. The OTP prompt cannot be answered from a non-interactive shell, so a
  human had to enable 2FA and approve a browser login before the publish could finish. The move to a new scope touched
  every import in this repo.
Severity: Medium — the publish waited on a human step (same day, 2026-10-15); it blocked switching Described off the `link:` override.
Workaround: 2FA on; publish with `npm publish` and browser web-auth by the human; Described consumes `@moiz0309/vega-media-kit@^0.2.0`.
Suggestion: say "two-factor authentication is required to publish" in the E403 body with a link to the 2FA page; for
  CI or agents, document trusted publishing (OIDC) or a granular token as the non-interactive path in the same place.
Environment: macOS, npm 10.9, Node.js 22, scope @moiz0309, 2026-10-15.
Links: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification ·
  https://docs.npmjs.com/configuring-two-factor-authentication · https://docs.npmjs.com/about-access-tokens ·
  https://www.npmjs.com/package/@moiz0309/vega-media-kit · PR #79
