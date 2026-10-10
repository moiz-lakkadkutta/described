# Described — Devpost submission text (draft)

Draft for DESC-012 (W1-G). Paste section by section into the Devpost form on Oct 21; submit Oct 22 evening Berlin
(team schedule; deadline Oct 23 21:00). Checked against the runbook §9 definition of done. Every number carries its
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
| Demo video | TODO(human): YouTube URL (upload Oct 20), < 3:00 — runbook §9 asks for "public"; confirm unlisted is accepted or upload public |
| Team members | TODO(human): names and Devpost handles |
| Built with | Amazon Bedrock (Qwen3-VL 235B, Nova Lite), Amazon Polly, Amazon Transcribe, Amazon S3, Amazon CloudFront, AWS CDK, React Native, Expo, react-native-video, Shaka Packager, ffmpeg, Express, Prisma, PostgreSQL, pg-boss, TypeScript |
| Try it | TODO(human): how judges try it (README "Run it", APK sideload, or video only) |

---

## What it does

Described plays films with audio description on Fire TV — for video that has none. Press play, and in the gaps between
dialogue a voice tells you what is on screen: who is there, what they do, where it happens, and any words that appear.

- **Description is on by default.** The whole app works with the D-pad, Select, Back and Menu, and every control carries a
  VoiceView label. Full VoiceView run-through: TODO(human) (waves plan H3).
- **Fire TV's own track selector is the switch.** The narration is a second audio track in the stream, marked as
  description. Menu shows Audio — Original · Audio description, and Captions — Off · Captions · Rich captions ·
  Description text.
- **Rich captions** add sounds and music in brackets for viewers who are deaf or hard of hearing.
- **Extended mode** pauses the film when there is more to describe than the gap allows, speaks, and carries on — the
  behaviour WCAG 1.2.7 (extended audio description) describes. It can be turned off.

## How we built it

A title goes through the pipeline in `packages/pipeline` (probe → shots → speech map → describe → fit → voice → mix → text → package → publish), run as pg-boss jobs behind an Express API:

1. **Shots** — ffmpeg scene detection splits the film into shots.
2. **Speech map** — Amazon Transcribe word timings mark where dialogue is; the spaces between are where narration may speak.
3. **Describe** — each shot goes to **Qwen3-VL 235B on Amazon Bedrock** as 3–6 key frames, with a prompt built on the
   Netflix, Prime Video and DCMP description rules: present tense, objective, no names before they are spoken, on-screen
   text only when clearly legible. The step calls the Bedrock Converse API directly, once per shot, with a per-shot cache
   so a retry never pays twice ([decision 0005](decisions/0005-describe-direct-bedrock.md)).
4. **Fit** — **Amazon Nova Lite** shortens each description to fit its gap; a description that carries new information
   but has no gap becomes an extended cue.
5. **Voice** — **Amazon Polly** neural voices speak each cue.
6. **Mix** — ffmpeg ducks the soundtrack under the narration (−9 dB; measured 9.03 dB) and normalises to −24 LUFS
   ([0001](decisions/0001-week0-gates.md) §Local dry runs).
7. **Text** — captions, rich captions (Nova Lite) and the description text as WebVTT.
8. **Package and publish** — Shaka Packager writes an HLS master with two audio tracks (Original; Audio description
   with `CHARACTERISTICS="public.accessibility.describes-video"`) and up to three text tracks; S3 and CloudFront serve it.

On the TV, a React Native app (Expo, Fire OS) plays it through
[`@moizp/vega-media-kit`](https://github.com/moiz-lakkadkutta/vega-media-kit), our open-source player and cue-overlay
library (the Player screen plays through its `KitPlayer` and `CueOverlay`). Fire TV integrations: Android deep links
(`described://title/{slug}`, `described://play/{slug}?t=…`), an Android MediaSession module for remote media keys and
Alexa transport (device check pending), and a draft Fire TV catalog feed in case Amazon accepts us for catalog
integration ([fire-os-bindings](platform/fire-os-bindings.md)). TODO(human): firm up the MediaSession wording after the
DESC-008 device check (the module has not yet been compiled in a release build or run on the stick). Infrastructure is AWS CDK
(`infra/`). Every AWS call, its purpose and its cost is in [docs/aws.md](aws.md).

**Choosing the model was measured, not assumed.** Our quality gate was ≥ 70 % usable descriptions in a sample of shots
(Gate C, [decision 0001](decisions/0001-week0-gates.md)). Nova Pro, our first choice, scored 41.4 % on 29 shots of Sintel. We then ran the same 29 shots and
the same prompt through four models, rated blind by two raters: Qwen3-VL 235B 75.9 %, TwelveLabs Pegasus 1.2 44.8 %,
Nova Pro 17.2 %, Nova 2 Lite 3.4 %. The full pipeline with Qwen3-VL then scored **72.4 %** usable on the five-point
rubric (faithful, on time, style, clean, fits), counting a shot only when both raters agreed
([decision 0003](decisions/0003-gate-c.md)). The raters were Claude models (Fable, then Opus) reading frame contact
sheets, not people — see Honest limits.

**What it costs.** Describing 2 minutes of film cost ≈ $0.03 on Bedrock (61,495 input tokens;
[docs/aws.md](aws.md), [0003](decisions/0003-gate-c.md)). A full 2-minute run, including Transcribe and Polly, is
estimated at ≈ $0.10–0.15 ([DESC-007 device check](device-checks/DESC-007.md) §0).
TODO(human): replace the estimate with the measured `costUsd` from the DESC-010 batch.

## Who it is for

Blind and low-vision viewers with a Fire TV and a remote, possibly using VoiceView — and the sighted person in the
household who usually sets the TV up. Beyond the living room: libraries, archives and broadcasters with
catalogues that have no description at all, who now have to make their services accessible.

## Potential impact

Audio description is expensive to make and scarce where it matters. Professional description costs $15–75 per minute
of video ([3Play Media](https://www.3playmedia.com/blog/how-much-does-audio-description-cost/)); our describe step cost
≈ $0.03 for two minutes ([docs/aws.md](aws.md)). Even a public broadcaster that invests heavily covers a fraction of its
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
- **The quality margin is thin.** 72.4 % clears the 70 % gate by 2.4 points. Every miss in the confirmation run was a
  wrong detail (direction, an invented "veiled face", "wings" for "wing"); only the last, "wings", came from the
  shortening step
  ([0003](decisions/0003-gate-c.md)). Follow-ups: a shortener that may not change facts (TASKS.md DESC-015) and per-title
  spot checks.
- **The raters were models.** Gate C was scored by two Claude raters against frame contact sheets. A usability session
  with a screen-reader user is planned. TODO(human): state whether it happened and link the notes.
- **Fire OS only.** Vega OS is experimental: no Vega SDK was installed and the media kit's Vega adapter is not finished
  ([decision 0004](decisions/0004-vega-deferred.md)).
- **No Fire TV search yet.** Catalog integration is available to select partners only; the feed is drafted and the request
  is TODO(human) (waves plan H12) ([fire-os-bindings §1](platform/fire-os-bindings.md#1-catalog-integration)).
  Personalization (continue watching in the Fire TV UI) needs catalog integration and is not built
  ([fire-os-bindings](platform/fire-os-bindings.md) table, row 3).
- **Switching audio takes about 450 ms**: the sound fades down, stays silent for ~150 ms while ExoPlayer resets its audio
  decoder, and fades back up (TASKS.md DESC-006). Before the fade, Gate A measured a 0.5–0.6 s stall on the stick
  ([0001](decisions/0001-week0-gates.md)).
- **Device checks pending.** The Player, Extended mode and platform-binding checks on the stick (docs/device-checks/DESC-006–008) had not been run on 2026-10-04. TODO(human): delete this line once they pass, or say what did not.
- **English only** in the demo titles. TODO(human): confirm; Polly's de-DE voice is wired but not shown.
- All demo content is CC-BY or public domain (Blender open movies, Internet Archive) with attribution in the app.
  TODO(human): list the five titles and their licences after the DESC-010 batch.

## Uniqueness statement (runbook §2)

Described and Lingo are substantially different entries. Different users: blind and low-vision viewers (Described)
versus language learners (Lingo). Different AI doing the load-bearing work: vision models and speech synthesis versus
transcription, translation and explanation. Different interaction: listen versus pause and study. They share
vega-media-kit the way two apps share React — it is infrastructure, published on its own.
TODO(human): confirm Lingo is submitted; add its Devpost URL here and link back from Lingo's write-up. If Lingo is not
submitted, delete this section.

## What's new since Aug 31, 2026

Everything. The repository's first commit is 2026-09-14 (`d84c3ea feat: scaffold described monorepo`), inside the
hackathon window. vega-media-kit was also created during the window: its first commit is `de646a1` on 2026-09-14.

## Open Source mini-challenge

| Field | Value |
|---|---|
| Project | `@moizp/vega-media-kit` — React Native player wrapper (Fire OS via react-native-video; Vega adapter experimental), WebVTT cue overlay, HLS/VTT parsers that run in Node, Fire TV platform bindings, focus helpers |
| Repository | https://github.com/moiz-lakkadkutta/vega-media-kit (MIT) |
| Release tag | TODO(human): tag after kit 0.1.0 (waves plan H11) |
| npm | TODO(human): `@moizp/vega-media-kit@0.1.0` once published (H11) |
| GitHub handle | TODO(human): confirm `moiz-lakkadkutta` and add teammates |
| Upstream contribution | TODO(human): URL of the PR to an AmazonAppDev sample, or delete the row (runbook §1) |
| How Described uses it | The Player screen plays through `KitPlayer` and `CueOverlay`. Planned: the pipeline validates its HLS output with the kit's `parseHlsMaster`, `audioTracksFromHls`, `textTracksFromHls` and `parseVtt` ([decision 0004](decisions/0004-vega-deferred.md) §Decision 3) — this lands with PR #16; TODO(human): state it as done once #16 merges, otherwise delete the sentence |
| Described itself | MIT, public: https://github.com/moiz-lakkadkutta/described |

## AWS Builder mini-challenge

Services and why each is load-bearing — the full table with costs is [docs/aws.md](aws.md):

- **Amazon Bedrock — Qwen3-VL 235B**: per-shot descriptions from key frames; chosen by the Gate C bake-off ([0003](decisions/0003-gate-c.md)).
- **Amazon Bedrock — Nova Lite**: shortens descriptions to fit dialogue gaps; writes rich captions.
- **Amazon Polly** (neural): the narration voice.
- **Amazon Transcribe**: word timings for the speech map; captions.
- **Amazon S3 + CloudFront**: sources, renditions and HLS delivery; CloudFront is configured to serve only `/published/*` (`infra/lib/media-stack.ts`). TODO(human): confirm after the media-stack deploy.
- **AWS CDK**: the whole stack as code in `infra/`.

Dev tooling listed in [docs/aws.md](aws.md): Claude Code, Kiro Crew, Amazon Devices Builder Tools MCP.
TODO(human): confirm Kiro Crew and the Builder Tools MCP were actually used before claiming them.

## Feedback and friction

- Product feedback (five required answers): [docs/feedback.md](feedback.md) — TODO(human): link once W2-C writes it.
- Feature requests with priorities: [docs/feature-requests.md](feature-requests.md).
- Friction logs: [docs/friction/](friction/) — 16 on 2026-10-04 (runbook target 8–12; §9 requires ≥ 8). TODO(human): recount at submission.

## Definition-of-done check (runbook §9)

| Item | Status |
|---|---|
| Public repo, MIT at root, README ≤ 10 steps, architecture, "what's new since Aug 31" | README has all three; repo is public |
| Runs on Fire OS; Vega documented as experimental | Fire OS; Vega in [0004](decisions/0004-vega-deferred.md) |
| ≥ 3 Fire TV platform integrations, each with a screenshot or log in the README | **At risk — 2 implemented** (launch intents / deep links; MediaSession), **neither device-verified**; catalog integration is partner-only (draft feed only); Personalization is not feasible on Fire OS before the freeze ([fire-os-bindings](platform/fire-os-bindings.md)). The audio-track selector is not counted: it is HLS playback, not a platform integration. TODO: README evidence section (W2-C) |
| Video < 3:00, public, on the device; Vega moment | [video-script.md](video-script.md); no Vega moment, by decision 0004. Runbook §9 says "public on YouTube/Vimeo": TODO(human) confirm an unlisted upload is accepted, or upload public |
| Text: what, how, who, impact with a cited number | This file |
| Tracks declared; Open Source section with repo, tag, handle, upstream PR | Above; tag, npm and PR are TODO(human) |
| `docs/aws.md` lists every call, purpose, cost | [docs/aws.md](aws.md) |
| Feedback (5 answers), feature requests with priorities, ≥ 8 friction logs | Friction ✓ (16); feedback and requests in W2-C |
| Tests pass in CI on the default branch; `pnpm i && pnpm dev` shows something | PR #10 adds the Expo dev script; TODO(human): verify both on the final commit |
| All materials in English | ✓ |

## Sources

Project (in this repo):
- [0001 week-0 gates](decisions/0001-week0-gates.md) · [0003 Gate C](decisions/0003-gate-c.md) · [0004 Vega deferred](decisions/0004-vega-deferred.md) · [0005 direct Bedrock](decisions/0005-describe-direct-bedrock.md) · [docs/aws.md](aws.md) · [fire-os-bindings](platform/fire-os-bindings.md) · [DESC-007 device check](device-checks/DESC-007.md) · [README](../README.md)

Internal notes (not public, not for the Devpost form): "runbook §n" and "PLAN §n" refer to the team's private planning
documents linked from [docs/PLAN.md](PLAN.md); they are not sources.

Public (fetched 2026-10-04):
- 3Play Media, "How Much Does Audio Description Cost?" — https://www.3playmedia.com/blog/how-much-does-audio-description-cost/ — "ranging from $15 to $75 per minute"
- ZDF, "Audiodeskription im ZDF" — https://www.zdf.de/unternehmen/verantwortung/barrierefreiheit-audiodeskription-102.html — 2025: Hauptprogramm 32,0 %, ZDFneo 12,2 %, 3sat 12,7 %, Fiction Primetime 99,5 %
- American Council of the Blind, "ACB Survey Finds Need for Increased Audio Description" — https://www.acb.org/content/acb-survey-finds-need-increased-audio-description — "More than 479 people filled out the survey"; "75.3% of respondents strongly agree that a greater amount of audio-described programming is needed"; the page is undated, its references say "Accessed Oct. 24, 2016"
- Directive (EU) 2019/882 (European Accessibility Act) — https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng — "They shall apply those measures from 28 June 2025"; scope includes "services providing access to audiovisual media services"
- Directive (EU) 2018/1808 (AVMSD amendment), Article 7 — https://eur-lex.europa.eu/eli/dir/2018/1808/oj/eng — "made continuously and progressively more accessible to persons with disabilities"
