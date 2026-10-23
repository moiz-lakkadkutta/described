# Described — Devpost submission text

Draft for DESC-012 (W1-G). Hackathon: Build, Ship, Shape: Amazon Developer Hackathon (Devpost). Paste section by section
into the Devpost form. The project is submitted on Devpost. Deadline: **Fri 23 Oct 2026, 12:00 PDT** (21:00 Berlin).
Refreshed 2026-10-23 against main `9d7d7ac`. Checked against the runbook §9 definition of done. Every number carries its
source; anything that needs a person is marked **TODO(human)**. Sources are listed at the end.

---

## Devpost fields

| Field | Value |
|---|---|
| Project name | Described |
| Tagline | Audio description and rich captions for video that has none — on Fire TV. |
| Tracks | **Fire TV** · **AWS Builder** mini-challenge · **Open Source** mini-challenge (runbook §1, §2) |
| Platform | Fire OS (Fire TV Stick, Fire OS 7). Vega OS: experimental, not built ([decision 0004](decisions/0004-vega-deferred.md)) |
| Repository | https://github.com/moiz-lakkadkutta/described (public, MIT `LICENSE` at the root) |
| Demo video | **Public** on YouTube (the rules ask for a publicly visible video; not Unlisted), < 3:00. TODO(human): what is the video's URL? |
| Team members | Moiz — solo entry (GitHub `moiz-lakkadkutta`). TODO(human): what is Moiz's Devpost handle? |
| Built with | Amazon Bedrock (Qwen3-VL 235B, DeepSeek v3.2, Amazon Nova Lite, Amazon Nova Pro as fallback), Amazon Polly (generative voice Ruth), Amazon Transcribe, Amazon S3, Amazon CloudFront, AWS Lambda, Amazon RDS for PostgreSQL, AWS Secrets Manager, AWS CDK, React Native, Expo, react-native-video, Shaka Packager, ffmpeg, Express, Prisma, PostgreSQL, pg-boss, TypeScript |
| Try it | Sideload the release APK onto a Fire TV: `adb connect <fire-tv-ip>:5555`, `adb install -r described-0.1.0.apk` (README, "Try it"). The APK talks to a hosted copy of the API over HTTPS (AWS Lambda function URL + Amazon RDS, us-east-1, DESC-034) and streams from CloudFront, so it needs nothing on the judge's network. The hosted API is live with all six titles seeded, and it stays up until 20 Nov 2026, the end of judging (user decision 2026-10-19). Release with the APK: https://github.com/moiz-lakkadkutta/described/releases/tag/v0.1.0 (`described-0.1.0.apk`, built from `d0608dc`, sha256 `b417fe075496802ae5ef4a2820321263713b07e01c0a1ff9ad6cfe54d281aaec`). No Fire TV: the same APK installs on an Android TV emulator; the [screenshots](screens/README.md) were captured with it on one (API 31, arm64). Or watch the demo video. |

---

## What it does

Described plays films with audio description on Fire TV — for video that has none. Press play, and in the gaps between
dialogue a voice tells you what is on screen: who is there, what they do, where it happens, and any words that appear.

- **Description is on by default.** The whole app works with the D-pad, Select, Back and Menu, and every control carries a
  VoiceView label. Full VoiceView run-through ([checklist](a11y/voiceview-checklist.md); no `docs/a11y/voiceview-<date>.md` yet, TASKS.md DESC-009):
  TODO(human): did the full VoiceView pass on the stick pass?
- **Fire TV's own track selector is the switch.** The narration is a second audio track in the stream, marked as
  description. Menu shows Audio — Original · Audio description, and Captions — Off · Captions · Rich captions ·
  Description text.
- **Rich captions**, for viewers who are deaf or hard of hearing, add a bracketed sound, and a speaker's name when it is
  spoken, only where a description names the sound and the soundtrack is audible there. Described has no audio-event
  detection, so sound cues are sparse and music is not tagged. A title where nothing qualifies ships Captions without a
  Rich-captions track. Two titles have one today: the whole of Sintel (`[creature roars]` at 3:23, `[woman gasps]` at 5:33)
  and Sintel 1:30–2:30 ([titles](titles.md)).
- **Extended mode** pauses the film when there is more to describe than the gap allows, speaks, and carries on — the
  behaviour WCAG 1.2.7 (extended audio description) describes. It can be turned off.

## How we built it

A title goes through the pipeline in `packages/pipeline` (probe → shots → speech map → describe → verify → scenes → fit →
narrative pass → voice → mix → text → package → validate → publish), run as pg-boss jobs behind an Express API or in-process by the CLI:

1. **Shots** — ffmpeg scene detection splits the film into shots.
2. **Speech map** — Amazon Transcribe word timings mark where dialogue is; the spaces between are where narration may speak.
3. **Describe** — each shot goes to **Qwen3-VL 235B on Amazon Bedrock** as 3–6 key frames, with a prompt built on the
   Netflix, Prime Video and DCMP description rules: present tense, objective, no names before they are spoken, on-screen
   text only when clearly legible. The step calls the Bedrock Converse API directly, once per shot, with a per-shot cache
   so a retry never pays twice ([decision 0005](decisions/0005-describe-direct-bedrock.md)). A **verify pass** sends the
   same frames and the draft back to Qwen3-VL, which may only remove what the frames do not show
   ([0010](decisions/0010-verify-pass.md)); a **scenes** step (Nova Lite) groups shots into places with a people-and-places glossary
   ([0012](decisions/0012-characters-and-scenes.md)).
4. **Fit** — **Amazon Nova Lite** shortens each description to fit its gap; a description that carries new information
   but has no gap becomes an extended cue.
5. **Narrative pass** — **DeepSeek v3.2 on Amazon Bedrock** (Amazon Nova Pro as fallback) joins the cues of a scene into one
   connected narration ("she" for a character just named, no repeated looks), and every rewrite passes deterministic guards
   (facts kept, names only after they are revealed, pronouns only with a clear referent) or the cue keeps its old text
   ([0017](decisions/0017-narrative-pass.md)).
6. **Voice** — **Amazon Polly**, generative voice **Ruth**, speaks each cue; the clip's measured length sets the cue end.
7. **Mix** — ffmpeg ducks the soundtrack under the narration (−9 dB; measured 9.03 dB) and normalises to −24 LUFS
   ([0001](decisions/0001-week0-gates.md) §Local dry runs).
8. **Text** — captions (Transcribe), rich captions (Nova Lite proposes sounds and speaker names; only evidenced ones are kept) and the description text as WebVTT.
9. **Package and publish** — Shaka Packager writes an HLS master with two audio tracks (Original; Audio description
   with `CHARACTERISTICS="public.accessibility.describes-video"`) and up to three text tracks; S3 and CloudFront serve it.

On the TV, a React Native app (Expo, Fire OS) plays it through
[`@moiz0309/vega-media-kit`](https://github.com/moiz-lakkadkutta/vega-media-kit), our open-source player and cue-overlay
library (the Player screen plays through its `KitPlayer` and `CueOverlay`). Fire TV integrations: Android deep links
(`described://title/{slug}`, `described://play/{slug}?t=…`), an Android MediaSession module for remote media keys and
Alexa transport, captions that follow the viewer's Fire TV caption settings (Android `CaptioningManager`, integration
3, pending device check), VoiceView support (integration 4: purpose labels, roles, spoken focus and usage hints, pending
device check — [DESC-035](device-checks/DESC-035.md)), and a draft Fire TV catalog feed in case Amazon accepts us for catalog
integration ([fire-os-bindings](platform/fire-os-bindings.md)). On the stick (device run 2026-10-10, release build): deep
links and the remote's media keys passed, and the MediaSession module compiles in the release build; Alexa voice transport
did not reach the app: inconclusive on 2026-10-14, and on 2026-10-19 Fire TV's logs said "No target session" for every
voice directive. The cause was a missing permission (`com.amazon.permission.media.session.voicecommandcontrol`); the fix is
merged (#86) and in the v0.1.0 APK, and the device re-check is pending, so we do not claim voice works yet. Infrastructure is AWS CDK
(`infra/`); the hosted API the release APK talks to is an AWS Lambda function URL with Amazon RDS for PostgreSQL. Every AWS call, its purpose and its cost is in [docs/aws.md](aws.md).

**Choosing the model was measured, not assumed.** Our quality gate (Gate C, [decision 0001](decisions/0001-week0-gates.md),
rule in [evaluation.md](evaluation.md#the-bar)) is ≥ 70 % usable shots on the five-point rubric (faithful, on time, style,
clean, fits), rated blind by three raters, a shot counting when a majority says usable, and it must pass on **both** clips: a
tuned clip (Sintel 1:30–3:30, 29 shots) and a held-out one nothing was tuned on (Tears of Steel 6:30–8:30, 31 shots).
Nova Pro, our first choice, scored 41.4 % on the Sintel shots. We then ran the same 29 shots and the same prompt through
four models: Qwen3-VL 235B 75.9 %, TwelveLabs Pegasus 1.2 44.8 %, Nova Pro 17.2 %, Nova 2 Lite 3.4 %; the full pipeline with
Qwen3-VL then scored 72.4 % with two raters ([decision 0003](decisions/0003-gate-c.md)). That run chose the model.

**Gate C today: passed on both clips.** Run g13 (2026-10-15, main `0bed29c`, with the narrative pass and Ruth) scored
**24 / 29 = 82.8 %** on Sintel and **24 / 31 = 77.4 %** on the held-out Tears of Steel clip
([evaluation.md](evaluation.md#gate-c-results), [0017](decisions/0017-narrative-pass.md)). See Honest limits for what this
run did and did not re-test.

**What it costs.** End to end, about **$0.086 per minute of film** with the generative voice (≈ $0.076 with a neural voice):
Transcribe, describe + verify, fit, the narrative pass, Polly and the text step, at `cost.ts` list prices
([docs/aws.md](aws.md#cost-per-title)); about **$5.14 per hour** of film (README, "Cost per hour of film"). Measured with the
pipeline's own meter: $0.051–0.059 per 60 s title (2026-10-14, before the verify and narrative passes), **$1.10** for the
whole 14:48 Sintel (2026-10-15, verify on, neural voice), and $0.36 to re-voice all six titles in Ruth from fit
([titles](titles.md)). These are list prices, not an AWS bill.

## Who it is for

Blind and low-vision viewers with a Fire TV and a remote, possibly using VoiceView — and the sighted person in the
household who usually sets the TV up. Beyond the living room: libraries, archives and broadcasters with
catalogues that have no description at all, who now have to make their services accessible.

## Potential impact

Audio description is expensive to make and scarce where it matters. Professional description costs $15–75 per minute
of video ([3Play Media](https://www.3playmedia.com/blog/how-much-does-audio-description-cost/)); Described costs about
$0.09 a minute end to end at list prices ([docs/aws.md](aws.md#cost-per-title)). Even a public broadcaster that invests heavily covers a fraction of its
output: in 2025 ZDF carried audio description on 32.0 % of its main channel, 12.2 % of ZDFneo and 12.7 % of 3sat —
against 99.5 % of prime-time fiction ([ZDF](https://www.zdf.de/unternehmen/verantwortung/barrierefreiheit-audiodeskription-102.html)).
Viewers noticed: in an American Council of the Blind survey of more than 479 people (published around 2016 — the
page's references were accessed in October 2016), 75.3 % strongly agreed that more audio-described programming was needed ([ACB](https://www.acb.org/content/acb-survey-finds-need-increased-audio-description)).
The obligation is now law. The European Accessibility Act has applied since 28 June 2025 to the players and apps through
which audiovisual media is accessed — in its words, "services providing access to audiovisual media services" ([Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng));
the Audiovisual Media Services Directive requires media services to be made "continuously and progressively more
accessible to persons with disabilities" ([Directive (EU) 2018/1808, Art. 7](https://eur-lex.europa.eu/eli/dir/2018/1808/oj/eng)).
Described targets the long tail — the archive film, the short, the library catalogue that will never get a human
describer — and delivers description through the TV's own audio-track selector, so no new habit is needed.

## Honest limits

- **AI-drafted, not human-authored.** Described drafts description for video that has none. Human-authored description
  remains the gold standard, and Described follows its style rules rather than replacing it.
- **Gate C passed, with caveats.** g13 passed both clips (Sintel 24 / 29 = 82.8 %, held-out Tears of Steel 24 / 31 = 77.4 %),
  so the earlier human exception for glossary titles ([0016](decisions/0016-ship-on-glossary-titles.md)) is superseded by
  [0017](decisions/0017-narrative-pass.md). But g13 re-ran fit → narrative pass → voice on **g12's describe output**: the
  describe step itself was last gated in g12, which passed Sintel (21 / 29 = 72.4 %) and failed the held-out clip (18 / 31 =
  58.1 %). The gate counts an unvoiced shot like a voiced one, and g13 voiced only 15 of Sintel's 29 shots (voiced-usable 11 /
  15; Tears of Steel 20 / 26), with 10 plot events lost on Sintel. Remaining faults: details borrowed from neighbouring shots,
  article-less fragments, a "Ruin:" label read aloud, "the man" pointing at the wrong man
  ([evaluation.md](evaluation.md#gate-c-results)). Earlier re-checks (g8–g12) are in the same table.
- **The raters were models.** No person rated Gate C. The model-selection rounds (A2, [0003](decisions/0003-gate-c.md)) were
  rated by two Claude raters, Fable then Opus, as recorded there. The re-checks g8 and g9 were rated by two, and g10 to g13
  by three, independent Claude Opus 5.5 sub-agents (`claude-opus-5-5`) per clip, blind: each worked from contact sheets
  and frames in its own folder with RUBRIC.md and never saw the prompts, the model names or the other raters. Up to g9 a
  shot counted only when both raters said usable; from g10 on, when a majority did ([evaluation.md](evaluation.md#the-bar)).
- **Rich captions are sparse by design.** Described has no audio-event detection, so a sound is tagged only where a
  description names it (or a source that always makes it) and the soundtrack is audible there; music is not tagged. Two of
  the six titles carry a Rich-captions track, with two sound cues each; Tears of Steel, Big Buck Bunny and Elephants Dream
  ship Captions only, because nothing qualified, and Caminandes has no speech ([titles](titles.md), [0018](decisions/0018-sdh-trim.md)).
- **Fire OS only.** Vega OS is experimental: no Vega SDK was installed and the media kit's Vega adapter is not finished
  ([decision 0004](decisions/0004-vega-deferred.md)).
- **No Fire TV search yet.** Catalog integration is available to select partners only. We have a draft catalog feed only
  (`GET /catalog/fire-tv.xml`); it has not been requested from Amazon (user decision 2026-10-19;
  [fire-os-bindings §1](platform/fire-os-bindings.md#1-catalog-integration)).
  Personalization (continue watching in the Fire TV UI) needs catalog integration and is not built
  ([fire-os-bindings](platform/fire-os-bindings.md) table, row 3).
- **Switching audio takes about 450 ms**: the sound fades down, stays silent for ~150 ms while ExoPlayer resets its audio
  decoder, and fades back up (TASKS.md DESC-006). Before the fade, Gate A measured a 0.5–0.6 s stall on the stick
  ([0001](decisions/0001-week0-gates.md)).
- **Device checks partly done.** On the stick (device run 2026-10-10, recorded in TASKS.md; checklist
  [RUN-2026-10](device-checks/RUN-2026-10.md)) the Player checks 5–8 passed (DESC-006), deep links (check 12) and media
  keys (check 13) passed (DESC-008). Still open on 2026-10-23: the by-ear re-check of the faded audio switch
  (check 6, build 788e973), Alexa voice transport (check 14: fix merged in #86, device re-check pending), Extended mode (DESC-007,
  [device check](device-checks/DESC-007.md) not run; pause timing fixed after the last stick run: a pause keeps 500 ms
  before the next clip or speech, #87, and starts early, never late, #88 / [0019](decisions/0019-extended-lead.md)), and Fire TV caption settings and
  VoiceView ([DESC-035](device-checks/DESC-035.md) §1, §2). TODO(human): which of check 6, DESC-007 and DESC-035 §1 / §2 have passed on the stick?
- **Not in the Amazon Appstore yet.** The submission kit is ready ([docs/appstore](appstore/SUBMIT.md): listing, privacy
  policy, screenshots), but it is not submitted. The APK needs a manifest fix first: it declares no `uses-feature` for
  touchscreen or microphone with `required="false"`, and expo-audio adds `RECORD_AUDIO`, which implies a required
  microphone. Until then, the v0.1.0 APK is sideloaded with `adb`.
- **English only** in the demo titles: all six are `en`, voiced by Polly Ruth (generative) ([titles](titles.md), "Published
  state"). German (`de`, Polly Vicki and Daniel) is wired but not shown.
- All demo content is CC-BY (Blender open movies) with attribution in the app (Title screen, Settings → About & licenses). The six
  titles ([docs/titles.md](titles.md)), 166 description cues in all: the whole of Sintel (2010, CC-BY 3.0; 14:48, 117 cues, 18
  extended) and 60 s segments of Sintel (8 cues), Big Buck Bunny (2008, CC-BY 3.0; 9), Elephants Dream (2006, CC-BY 2.5; 7),
  Caminandes: Gran Dillama (2013, CC-BY 3.0; 11) and Tears of Steel (2012, CC-BY 3.0; 14), from download.blender.org.

## Uniqueness statement (runbook §2)

Described and Lingo are substantially different entries. Different users: blind and low-vision viewers (Described)
versus language learners (Lingo). Different AI doing the load-bearing work: vision models and speech synthesis versus
transcription, translation and explanation. Different interaction: listen versus pause and study. They share
vega-media-kit the way two apps share React — it is infrastructure, published on its own.
Lingo is submitted; its write-up should link back here. TODO(human): what is Lingo's Devpost URL?

## What's new since Aug 31, 2026

Everything. The repository's first commit is 2026-09-14 (`d84c3ea feat: scaffold described monorepo`), inside the
hackathon window. vega-media-kit was also created during the window: its first commit is `de646a1` on 2026-09-14.

## Open Source mini-challenge

| Field | Value |
|---|---|
| Project | `@moiz0309/vega-media-kit` — React Native player wrapper (Fire OS via react-native-video; Vega adapter experimental), WebVTT cue overlay, HLS/VTT parsers that run in Node, Fire TV platform bindings, focus helpers |
| Repository | https://github.com/moiz-lakkadkutta/vega-media-kit (MIT) |
| Release tag | [`v0.2.0`](https://github.com/moiz-lakkadkutta/vega-media-kit/releases/tag/v0.2.0) (GitHub release, 2026-10-15; matches the npm release); earlier [`v0.1.0`](https://github.com/moiz-lakkadkutta/vega-media-kit/releases/tag/v0.1.0) (GitHub release, 2026-10-14) |
| npm | [`@moiz0309/vega-media-kit@0.2.0`](https://www.npmjs.com/package/@moiz0309/vega-media-kit) — 0.1.0 was a GitHub release only; 0.2.0 is the first npm release (the `@moizp` scope was never published). Published 2026-10-15, tagged [`v0.2.0`](https://github.com/moiz-lakkadkutta/vega-media-kit/releases/tag/v0.2.0). Described installs it from npm as `^0.2.0`. |
| GitHub handle | `moiz-lakkadkutta` (owner of both repositories) |
| Upstream contribution | [AmazonAppDev/react-native-multi-tv-app-sample#136](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample/pull/136) — "fix(expo): enable ExoPlayer HLS so .m3u8 sources play on Fire TV / Android TV" (opened 2026-10-14; open, not merged, on 2026-10-15) |
| How Described uses it | The Player screen plays through `KitPlayer` and `CueOverlay`. The pipeline's `validate` step checks its HLS output with the kit's `parseHlsMaster`, `audioTracksFromHls`, `textTracksFromHls` and `parseVtt` (`packages/pipeline/src/validate.ts`; PR #16, merged 2026-10-04; [decision 0004](decisions/0004-vega-deferred.md) §Decision 3) |
| Described itself | MIT, public: https://github.com/moiz-lakkadkutta/described |

## AWS Builder mini-challenge

Services and why each is load-bearing — the full table with costs is [docs/aws.md](aws.md):

- **Amazon Bedrock — Qwen3-VL 235B**: per-shot descriptions from key frames; chosen by the Gate C bake-off ([0003](decisions/0003-gate-c.md)).
- **Amazon Bedrock — Qwen3-VL 235B, verify pass**: the same frames and the draft again; removes what the frames do not show ([0010](decisions/0010-verify-pass.md)).
- **Amazon Bedrock — Nova Lite**: shortens descriptions to fit dialogue gaps; writes rich captions.
- **Amazon Bedrock — DeepSeek v3.2** (Nova Pro fallback): the narrative pass that joins a scene's cues into one narration, under deterministic guards ([0017](decisions/0017-narrative-pass.md)).
- **Amazon Polly** (generative voice Ruth): the narration voice, one clip per cue.
- **Amazon Transcribe**: word timings for the speech map; captions.
- **Amazon S3 + CloudFront**: sources, renditions and HLS delivery; CloudFront serves only `/published/*` (`infra/lib/media-stack.ts`). Deployed and checked 2026-10-15: distribution
  `E2P33RN2ZSRFN0` has one `/published/*` behaviour, the default behaviour runs the `DenyUnpublished` viewer-request function,
  the bucket policy denies CloudFront `s3:GetObject` outside `published/*`, and any other path answers 403.
- **AWS Lambda + Amazon RDS for PostgreSQL** (hosted API, DESC-034): the release APK's API — Express in viewer mode behind an
  HTTPS function URL, RDS db.t4g.micro in isolated subnets with no NAT, ≈ $14.50 a month (`infra/lib/viewer-stack.ts`,
  [docs/aws.md](aws.md#hosted-api-desc-034)). Deployed and seeded with the six titles; kept up until 20 Nov 2026 (end of judging).
- **AWS Secrets Manager**: the database password, generated at deploy.
- **AWS CDK**: the whole stack as code in `infra/`.

Dev tooling listed in [docs/aws.md](aws.md): Claude Code.

## Feedback and friction

- Product feedback (five required answers): [docs/feedback.md](feedback.md) (PR #36).
- Feature requests with priorities: [docs/feature-requests.md](feature-requests.md).
- Friction logs: [docs/friction/](friction/) — 29 on 2026-10-23, not counting its README (runbook target 8–12; §9 requires ≥ 8).

## Definition-of-done check (runbook §9)

| Item | Status |
|---|---|
| Public repo, MIT at root, README ≤ 10 steps, architecture, "what's new since Aug 31" | README has all three; repo is public |
| Runs on Fire OS; Vega documented as experimental | Fire OS; Vega in [0004](decisions/0004-vega-deferred.md) |
| ≥ 3 Fire TV platform integrations, each with a screenshot or log in the README | **At risk — 4 implemented, 2 verified** (1 launch intents / deep links; 2 MediaSession; 3 Fire TV caption settings via CaptioningManager — **pending** device check; 4 VoiceView — **pending** device check, [DESC-035](device-checks/DESC-035.md)). Fire TV Recommendations was retired by Amazon in May 2025 (docs 404). Deep links and media keys passed on the stick (device run 2026-10-10, checks 12–13); Alexa voice transport: fix merged (#86), device re-check pending; catalog integration is partner-only (draft feed only); Personalization is not feasible on Fire OS before the freeze ([fire-os-bindings](platform/fire-os-bindings.md)). The audio-track selector is not counted: it is HLS playback, not a platform integration. The README's [Screens](../README.md#screens) are emulator screenshots of the UI, not device evidence for the integrations. TODO(human): which photos or logcat lines from the device runs go in the README as evidence? |
| Video < 3:00, public, on the device; Vega moment | [video-script.md](video-script.md); upload **Public** on YouTube (the rules require a publicly visible video); no Vega moment, by decision 0004 |
| Text: what, how, who, impact with a cited number | This file |
| Hosted stack stays up for judges until the judging period ends (20 Nov) | Kept up until 20 Nov 2026 (user decision 2026-10-19); ≈ $14.50 a month ([aws.md](aws.md#hosted-api-desc-034)) |
| Tracks declared; Open Source section with repo, tag, handle, upstream PR | Above; tag `v0.2.0`, npm `@moiz0309/vega-media-kit@0.2.0` and upstream PR #136 done |
| `docs/aws.md` lists every call, purpose, cost | [docs/aws.md](aws.md) |
| Feedback (5 answers), feature requests with priorities, ≥ 8 friction logs | ✓ — friction 29, [feedback.md](feedback.md), [feature-requests.md](feature-requests.md) |
| Tests pass in CI on the default branch; `pnpm i && pnpm dev` shows something | CI green on main at `9d7d7ac` (2026-10-22, `gh run list --branch main`); `pnpm dev` runs `turbo run dev --parallel` (API `tsx watch`, Expo `expo start`; PR #10, merged 2026-10-04). |
| All materials in English | ✓ |

## Sources

Project (in this repo):
- [0001 week-0 gates](decisions/0001-week0-gates.md) · [0003 Gate C](decisions/0003-gate-c.md) · [0004 Vega deferred](decisions/0004-vega-deferred.md) · [0005 direct Bedrock](decisions/0005-describe-direct-bedrock.md) · [0009 Gate C fits](decisions/0009-gate-c-fits.md) · [0010 verify pass](decisions/0010-verify-pass.md) · [0016 ship on glossary titles (superseded)](decisions/0016-ship-on-glossary-titles.md) · [0017 narrative pass](decisions/0017-narrative-pass.md) · [0018 Rich captions trim](decisions/0018-sdh-trim.md) · [evaluation](evaluation.md) · [titles](titles.md) · [RUN-2026-10 device run](device-checks/RUN-2026-10.md) · [TASKS.md](../TASKS.md) · [docs/aws.md](aws.md) · [fire-os-bindings](platform/fire-os-bindings.md) · [DESC-007 device check](device-checks/DESC-007.md) · [README](../README.md)

Internal notes (not public, not for the Devpost form): "runbook §n" and "PLAN §n" refer to the team's private planning
documents linked from [docs/PLAN.md](PLAN.md); they are not sources.

Public (fetched 2026-10-04):
- 3Play Media, "How Much Does Audio Description Cost?" — https://www.3playmedia.com/blog/how-much-does-audio-description-cost/ — "ranging from $15 to $75 per minute"
- ZDF, "Audiodeskription im ZDF" — https://www.zdf.de/unternehmen/verantwortung/barrierefreiheit-audiodeskription-102.html — 2025: Hauptprogramm 32,0 %, ZDFneo 12,2 %, 3sat 12,7 %, Fiction Primetime 99,5 %
- American Council of the Blind, "ACB Survey Finds Need for Increased Audio Description" — https://www.acb.org/content/acb-survey-finds-need-increased-audio-description — "More than 479 people filled out the survey"; "75.3% of respondents strongly agree that a greater amount of audio-described programming is needed"; the page is undated, its references say "Accessed Oct. 24, 2016"
- Directive (EU) 2019/882 (European Accessibility Act) — https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng — "They shall apply those measures from 28 June 2025"; scope includes "services providing access to audiovisual media services"
- Directive (EU) 2018/1808 (AVMSD amendment), Article 7 — https://eur-lex.europa.eu/eli/dir/2018/1808/oj/eng — "made continuously and progressively more accessible to persons with disabilities"
