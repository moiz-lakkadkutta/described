# Fire OS platform bindings — research and decisions (DESC-008)

Status: 2026-10-01 · Fire OS only (Vega deferred, decision 0004) · Freeze Oct 15

**How this was researched.** `developer.amazon.com` is blocked by this environment's egress proxy (WebFetch:
`EGRESS_BLOCKED`), so the Amazon pages below were **not read in full**. What is cited from them comes from search-result
excerpts of those pages, plus things checked first-hand in installed package sources (react-native-video 6.19.2,
expo-modules-autolinking 3.0.27, the kit's `src/platform/*`). Items marked **unverified** need a human with a browser
to confirm before submission.

| # | Binding | Fire OS mechanism | Decision | Built |
|---|---|---|---|---|
| 1 | Catalog (search, browse, "Alexa, play X") | Catalog integration: an XML file Amazon ingests. **Select partners only**; CDF is legacy, new partners use EMBER | **Submission-time, and only if Amazon accepts us** | Draft feed `GET /catalog/fire-tv.xml` |
| 2 | Launch / deep-link intents | Android `VIEW` intent on a custom scheme; with catalog integration, also the Fire TV launcher's capabilities broadcast | **Implemented now** (scheme) · launcher broadcast **deferred with #1** | `described://title/{slug}`, `described://play/{slug}?t=…` |
| 3 | Personalization (continue watching, watchlist) | Fire TV Integration SDK (jar from Amazon + data-integration service); **needs catalog integration** | **Not feasible before freeze** | Interface + events, no-op reporter |
| 4 | Media controls / Alexa transport | Android `MediaSession` | **Implemented now** with a small native module | `modules/described-media-session` |

---

## 1. Catalog integration

**What it is.** Fire OS has no runtime catalog API. Titles show up in Fire TV search, browse rows and voice only once
Amazon ingests a catalog file describing them and matches it against its content database.

- "Catalog integration is available to select partners only." The file follows EMBER ("Enhanced Metadata Bridge for
  Entertainment Resources"). — https://developer.amazon.com/docs/catalog/ember-catalog-integration-overview.html
- CDF (Catalog Data Format) "is a legacy system and isn't supported for new integrations"; existing CDF integrations
  are still supported. — https://developer.amazon.com/docs/catalog/getting-started-catalog-ingestion.html ,
  element reference https://developer.amazon.com/docs/catalog/all-elements.html
- Each work needs at least one offer (`FreeOffer`, `SubscriptionOffer`, …). —
  https://developer.amazon.com/docs/catalog/create-your-catalog-file.html
- The catalog is linked to the app through **launcher integration** (#2) and verified per deep link. —
  https://developer.amazon.com/docs/catalog/integrate-with-launcher.html ,
  https://developer.amazon.com/docs/catalog/verify-deep-links-from-the-catalog.html

**Decision: submission-time only, and conditional.** We cannot self-serve catalog integration. What we can do before
the freeze is have the data ready:

- `GET /catalog/fire-tv.xml` (apps/api/src/routes/catalog.ts → `src/lib/fireTvCatalog.ts`) renders every *published*
  title as a CDF-shaped `<Catalog>`: `ID` = slug, `Title`, `FreeOffer` (territories, default US), `Synopsis`,
  `ReleaseDate`, `RuntimeMinutes`, `ImageUrl`; each `<Movie>` carries its deep links in a comment. Sorted by slug for
  clean diffs. `?partner=` sets `<Partner>`.
- **Unverified:** the namespace `http://www.amazon.com/FireTv/2014-04-11/ingestion`, `version="FireTv-v1.3"`, element
  names and order are from Amazon's CDF examples as remembered, not checked against the XSD. If Amazon takes us on they
  will ask for EMBER — `movie()` in `fireTvCatalog.ts` is the only function to rewrite; the input (`FeedTitle`) already
  has every field.

**How to produce the file at submission:**

```sh
pnpm db:up && pnpm api                         # API on :4000 with published titles
curl -s 'http://localhost:4000/catalog/fire-tv.xml?partner=<value Amazon assigns>' > described-catalog.xml
xmllint --noout described-catalog.xml          # well-formed; validate with the XSD Amazon provides (xmllint --schema)
```

Then: ask for catalog integration through the Amazon developer console contact / the app submission notes (needs the
human's Amazon developer account). Amazon provides the upload channel (historically an S3 drop) once accepted.

## 2. Launch and deep-link intents

**Plain Android deep links — implemented.** `scheme: "described"` in `apps/expo/app.json` makes Expo prebuild add
`<intent-filter>` VIEW / DEFAULT / BROWSABLE with `android:scheme="described"` to MainActivity, which Expo makes
`singleTask` (checked with `npx expo config --type introspect`; both present). React Native's `Linking` delivers the
URL: `getInitialURL()` for the link that started the activity, a `url` event while running
(https://reactnative.dev/docs/linking). `getInitialURL()` is read on every subscribe: Back on Home finishes the
activity but keeps the JS process, so a later link starts a new activity that must be handled even if it is the same
URL. It is de-duplicated per activity (same URL with no trip to the background → not replayed).

- Format (packages/contracts/src/deepLink.ts, shared by API and app):
  `described://title/{slug}` → Title; `described://play/{slug}` → Player at saved progress;
  `described://play/{slug}?t=754` → Player at 754 s. Parsed by hand (Hermes' URL polyfill is unreliable for custom
  schemes); bad slugs, other schemes and hosts are ignored; a non-finite `?t=` is ignored and one above 24 h is capped.
- Routing (packages/shared-ui/src/platform/launch.ts): Root holds the link until the catalog has loaded and first run
  is done, then navigates. A title missing from the catalog leaves the viewer on Home (never the offline screen).
  Play links start with description per `prefs.adDefault`. `?t=` is clamped with Player's own `clampSeek`
  (0 to 1 s before the end) and travels as the player route's `startAtS`, which Player uses instead of the saved
  position — without the resume-near-end rule (a saved point in the last 30 s starts over; an explicit `?t=` is
  honoured). The route key includes `startAtS`, so a play link for the title already playing remounts the Player.
  A link that replaces a playing Player first saves its position through the same step as Back (`exitPlayer` in Root).
- Test on the stick: `adb shell am start -a android.intent.action.VIEW -d "described://title/sintel-90-210"`.
  The Fire TV launcher's ADB test page uses the same `am start` form —
  https://developer.amazon.com/docs/catalog/test-launcher-integration-with-adb.html

**Fire TV launcher integration — deferred with #1.** For catalog titles the launcher does not open our URI; the app
sends a broadcast to `com.amazon.tv.launcher` with action `com.amazon.device.CAPABILITIES` naming the activity to
launch, answers `com.amazon.device.REQUEST_CAPABILITIES` with a receiver, and Fire TV then starts that activity with the
catalog ID from the offer (https://developer.amazon.com/docs/catalog/integrate-with-launcher.html). That needs a
partner ID from Amazon and a native receiver; it is pointless without an accepted catalog. When it happens, the
receiving activity maps the catalog ID (= slug) to `playLink(slug)` and the rest of this path is reused unchanged.
**Unverified:** the extra names Fire TV puts on that intent.

## 3. Content personalization (continue watching, watchlist)

- Watch activity = playback start, progress, pause/resume and exit events with content ID, profile ID, duration and
  position; state is PLAYING / PAUSED / EXIT / INTERSTITIAL. — https://developer.amazon.com/docs/fire-tv/watch-activity.html
- Delivered with the **Fire TV Integration SDK**: a jar (`com.amazon.tv.developer.content.sdk.jar`) downloaded from
  Amazon, `AmazonPlaybackReceiver.getInstance(context).addPlaybackEvent(...)`, `AmazonCustomerListReceiver` for the
  watchlist, a mandatory "Amazon Data Integration Service" the system calls back, a device-support check, a hashed
  profile ID. — https://developer.amazon.com/docs/fire-tv/get-started-with-firetv-integration-sdk.html ,
  sample https://github.com/amzn/ftv-integration-sdk-sample-app (read: README)
- Prerequisite: "your app must participate in the catalog integration process, so Fire TV recognizes the content IDs";
  supported device types via "your Amazon contact". —
  https://developer.amazon.com/docs/fire-tv/introduction-content-personalization.html

**Decision: not feasible before the freeze.** It depends on #1 (partner-only), needs a jar we cannot fetch here and a
native service. Built instead:

- `PlaybackReporter` in shared-ui (`report({ slug, positionS, durationS, state: 'playing' | 'paused' | 'exit' })`),
  fed from Player's now-playing (`onNowPlaying` → `usePlatformNowPlaying` in Root): on play, on pause, every 30 s
  while playing, and on exit — the same events Amazon asks for.
- `apps/expo/src/platform/personalization.ts` forwards to the kit's `personalization.reportPlayback`, which on Fire OS
  logs once and does nothing. When the SDK arrives: a native module calling `addPlaybackEvent`, swapped in here.
- Our own resume points are unaffected: Root still PUTs `/me/progress`.

## 4. Media controls and Alexa transport

**Mechanism.** "Apps on Fire TV can support voice-enabled playback controls by integrating the Android Media Session
API" — "Alexa, play / pause / fast-forward / rewind". With an app-only integration (no Video Skill), MediaSession is the
recommended path, and once integrated the app gets both near-field (remote mic) and far-field (Echo) commands. Set the
session flags `HANDLES_MEDIA_BUTTONS | HANDLES_TRANSPORT_CONTROLS` and declare actions on `PlaybackState`.
- https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html
- https://developer.amazon.com/docs/video-skills-fire-tv-apps/integrate-with-mediasession-app-only.html
- Near/far-field handling (pause or duck while Alexa listens, handle audio-focus changes in any order):
  https://developer.amazon.com/blogs/appstore/post/c6d362c4-64a0-4072-bce9-85abd44ee519/tips-for-handling-near-field-and-far-field-control-with-media-session-on-fire-tv

**Why not react-native-video's MediaSession (checked in source, 6.19.2).** RNV creates a Media3 `MediaSession` only
when `showNotificationControls` is true (`ReactExoplayerView.setShowNotificationControls` → `setupPlaybackService`,
binding `VideoPlaybackService`, a `MediaSessionService` with a notification). Two blockers:

1. The kit's Fire OS adapter (`src/player/adapters/fireos.tsx`) does not pass `showNotificationControls`, and has no
   prop pass-through; we may not change the kit.
2. That session wraps ExoPlayer directly, so "Alexa, pause" would pause ExoPlayer behind the kit's back: the kit's
   `paused` prop stays false, extended-description pause/speak/resume and the status line go out of sync.

**Decision: implemented now, with a small native module** (`apps/expo/modules/described-media-session`, ~120 lines of
Kotlin, autolinked as a local Expo module — no config plugin, no MainApplication patch, no Gradle dependencies since it
uses the framework `android.media.session` API, API 21+):

- One pipeline: Player reports `PlayerSession` through `onNowPlaying` (DESC-006's seam) on every state change and
  every committed seek (`seeks` counter). Root's `usePlatformNowPlaying` (shared-ui `platform/nowPlaying.ts`) turns
  that into `setNowPlaying(title, durationS, positionS, playing)` — so the session position is republished after
  each seek — and forwards it to `RootProps.onNowPlaying`. The first publish creates and activates the session;
  `release()` when the Player closes.
- The session **only reports**: `onPlay / onPause / onStop / onFastForward / onRewind / onSeekTo` become `onTransport`
  events; JS (`fromNative` → `transportAction`) calls `session.controls` — Player's own `play`, `pause` and `seekTo`
  (clamped, resume-aware), the same calls as the remote. Stop pauses (leaving is the viewer's Back, which saves
  progress). Skips use DESC-006's `SEEK_STEP_S`. Buffering counts as playing, so "pause" pauses a stalled film.
- **One path per media key** (`apps/expo/src/platform/mediaSession.ts`, tested key by key):
  `MEDIA_PLAY` 126, `MEDIA_PAUSE` 127, `MEDIA_STOP` 86 take the framework's default mapping in the session
  (→ `onPlay / onPause / onStop`; Alexa may send these), and the key source skips them (`setKeySkip(keySkipFor(…))`)
  only while a Player is published **and** native has reported `onSessionState { active: true }` — so a publish that
  found no React context (`ensure()` → null) or a backgrounded app never strands those keys. `PLAY_PAUSE` 85, `FAST_FORWARD` 90, `REWIND` 89 are relative: the session swallows them
  (logs `control=button`) and Player's key handling owns them (toggle, ◄► seek with commit). Without an active session
  every key stays on the key path. `createMediaSession(native, { acceptButtons: true })` moves the relative keys to the
  session and off the key path, if the device check shows Alexa sending them.
  **Device-dependent:** this relies on Android handing an unconsumed media key from the focused activity to the
  active session (MainActivity's `onKeyDown` does not consume media keys). If §4 of the device check shows 126/127
  doing nothing, set `MEDIA_SESSION_OWNS_KEYS = false` in apps/expo/src/platform/mediaSession.ts (one value; keys go
  back to the key path).
- **Fire TV's mapping.** Per the Fire TV doc's table, "Alexa, fast forward / rewind [N seconds]" and "restart" arrive
  as `onSeekTo(pos)` (ACTION_SEEK_TO; pos computed from the position the session reports, 10 s by default), not as
  `onFastForward / onRewind`; "pause" / "play" / "resume" come as media keys (126 / 127) or `onPause / onPlay`.
- **Visibility, not foreground.** The session goes inactive when the activity is no longer visible (`onActivityStopped`
  via `Application.ActivityLifecycleCallbacks`: Home, another app) and active again when it is started, if the Player
  still holds it — so Alexa never controls a hidden app. It stays active while the activity is merely **paused**: during
  a voice interaction Fire TV pauses the activity under the Alexa UI, and Fire TV's publisher (`whad`) unpublishes an
  inactive session at once, so a SeekTo directive arriving then finds no session and is dropped (device run check 14:
  fast forward / rewind / go to did nothing; pause / play, sent as media keys, still reached the last media-button
  session; every re-activation showed as a "New Session" in `whad`'s log — 13 in one playback). `OnActivityEntersBackground`
  (= onPause) only logs now; it is the fallback signal if no `Application` is reachable. A `destroyed` flag stops queued
  work and late callbacks after the module is torn down. Fire OS user builds drop `Log.d`: the module logs at `Log.i`.
- If the module is missing from a build, `requireOptionalNativeModule` returns null and the binding is a no-op.

**Risk and fallback.** The Kotlin was **not compiled** here (no Android SDK in this environment). If the release build
fails on it, exclude it — the app works as before, without Alexa transport:

```json
// apps/expo/package.json
"expo": { "autolinking": { "exclude": ["described-media-session"] } }
```

**Known gaps (device check):** near-field Alexa overlay should pause or duck (audio focus — RNV requests focus by
default; behaviour unverified).

**Extended description (DESC-007):** during a pause–speak–resume, "Alexa, resume" (or Play) ends the description at once
— the clip stops, then the film plays — so video never plays over the narration. "Alexa, pause" / the session-owned Pause
key (127) always reach the Player (`transportAction` no longer drops pause while the kit reports paused) and keep the film
paused after the clip.

## What the human needs to do

- **Amazon developer account / submission form:** ask Amazon for catalog integration (they decide; partner-only). If
  accepted: get the partner ID, EMBER schema/XSD and upload channel; then launcher integration and the Integration SDK
  jar. None of it blocks submission — the app is fully usable from its own rows.
- **Device:** run docs/device-checks/DESC-008.md, especially the release build with the new native module and the
  Alexa voice test.

## Code map

| Piece | File |
|---|---|
| Deep-link format + parser | packages/contracts/src/deepLink.ts |
| Catalog feed | apps/api/src/lib/fireTvCatalog.ts, route in apps/api/src/routes/catalog.ts |
| Launch routing | packages/shared-ui/src/platform/launch.ts (Root: `launches` prop + `useLaunchRoute`) |
| Transport, now-playing, watch activity | packages/shared-ui/src/platform/nowPlaying.ts (Root: `usePlatformNowPlaying` on Player's `onNowPlaying`) |
| Media-key ownership | apps/expo/src/platform/mediaSession.ts (`ownsKey`, `keySkipFor`, `MEDIA_SESSION_OWNS_KEYS`), apps/expo/src/remote.ts (`setKeySkip`) → the key hub's `setSkip` in apps/expo/src/keys.ts (skipped codes reach no subscriber) |
| Fire OS wiring | apps/expo/src/platform/*.ts, apps/expo/App.tsx (`configurePlatform`, `launches`) |
| Native media session | apps/expo/modules/described-media-session |
