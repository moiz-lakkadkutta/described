# Amazon Appstore listing — Described (Fire TV)

Copy for the Developer Console, field by field. Paste the text inside each block as it is: plain text, no Markdown (the
console strips HTML and paragraph breaks in the short description). Step-by-step order: [SUBMIT.md](SUBMIT.md).

Facts match [docs/submission.md](../submission.md) (six CC-BY titles, Fire OS only, description on by default). User-facing
copy follows [decision 0002](../decisions/0002-wording.md): plain, short, second person, present tense; never "AI", never
"enable/disable". Cost per minute is not store copy and is left out.

Field names and limits are from Amazon's docs, read 2026-10-22:
[Step 1: Upload Your App File](https://developer.amazon.com/docs/app-submission/upload-app-file.html),
[Step 2: Target Your App](https://developer.amazon.com/docs/app-submission/target-app.html),
[Step 3: Add Appstore Details](https://developer.amazon.com/docs/app-submission/appstore-details.html),
[Choosing a Category](https://developer.amazon.com/docs/app-submission/categories.html),
[Content Policy](https://developer.amazon.com/docs/policy-center/understanding-content-policy.html).

## App details (Step 1)

| Field | Value |
|---|---|
| App title (console only) | `Described` |
| App SKU (console only, max 150 chars) | `dev.moizp.described.v1` |
| App category | **Movies & TV › On-Demand Movie Streaming** (`movies-and-tv` › `on-demand-movie-streaming`) |
| Language support | English |
| Customer support website | `https://github.com/moiz-lakkadkutta/described/issues` |
| Customer support email / phone | Owner's choice — see [SUBMIT.md](SUBMIT.md), decision D5 |

## Display title (Step 3)

```
Described
```

## Short description (Step 3)

Limit: 2,000 bytes ≈ 1,200 English characters; Fire TV shows only the first 200 characters, then an ellipsis; paragraph
breaks are stripped. This text: 418 characters (418 bytes); the first 200 end at "…add rich captions with sound cues, or let", so description,
the Menu switch and rich captions all show before the ellipsis.

```
Films with audio description, on by default. In the gaps between dialogue, a voice tells you what's on screen. Press Menu while watching to turn it off or on, add rich captions with sound cues, or let Extended mode pause the film when there's more to describe than the gap allows. No account, no ads, free. Six Blender open films to start, including the whole of Sintel. Every control has a spoken label for VoiceView.
```

## Long description (Step 3)

Limit: 4,000 characters, plain text. Shown on the Appstore website and Fire tablets, not on Fire TV. This text: 2,524
characters.

```
Described plays films with audio description on Fire TV, for video that has none.

Press play, and in the gaps between dialogue a voice tells you what is on screen: who is there, what they do, where it happens, and any words that appear. Description is on by default, so a blind or low-vision viewer never has to find a setting first.

How it works on your TV
- The narration is a second audio track. Press Menu while watching to switch between Original and Audio description, or to change captions.
- Captions come in three kinds: Captions, Rich captions (with a bracketed sound such as [creature roars] where the film shows it), and Description text, the narration as on-screen text.
- Extended mode pauses the film when there is more to describe than the gap allows, speaks, and carries on. You can turn it off.
- Choose the voice, caption size and caption style in Settings, or let captions match your Fire TV caption settings.
- Everything works with the D-pad, Select, Back and Menu. Every control has a spoken label for VoiceView.

What you can watch
Six titles from the Blender open-movie projects: the whole of Sintel (15 minutes) and one-minute scenes from Sintel, Big Buck Bunny, Elephants Dream, Caminandes: Gran Dillama and Tears of Steel.

How the descriptions are made
Software writes and voices the descriptions, following the style rules professional describers use: present tense, only what can be seen, no names before the film reveals them. A human describer is still the gold standard, and a description can get a detail wrong. Described exists for the films no describer will ever reach.

No account, no ads, no in-app purchases. The app keeps your settings, My list and where you stopped watching against a key made from your device's Android ID. Privacy policy: https://github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md

Film credits
Sintel © Blender Foundation, CC-BY 3.0. Described by Described.
Big Buck Bunny © 2008 Blender Foundation, CC-BY 3.0. Described by Described.
Elephants Dream © 2006 Blender Foundation / Netherlands Media Art Institute, CC-BY 2.5. Described by Described.
Caminandes: Gran Dillama © 2013 Blender Foundation (a Blender Institute production, www.caminandes.org), CC-BY 3.0. Described by Described.
Tears of Steel © 2012 Blender Foundation, CC-BY 3.0. Described by Described.
Licences: https://creativecommons.org/licenses/by/3.0/ and https://creativecommons.org/licenses/by/2.5/

Described is open source (MIT): https://github.com/moiz-lakkadkutta/described
```

The credit sentences are the ones the app shows under Settings › About & licenses (`apps/api/prisma/titles.json`,
`attribution`), so the listing and the app say the same thing.

## Product feature bullets (Step 3)

Three to five, one per line (the console turns each line into a bullet).

```
Audio description on by default: a voice tells you what's on screen in the gaps between dialogue
Press Menu while watching to switch between Original and Audio description, and to change captions
Rich captions add bracketed sounds for viewers who are deaf or hard of hearing
Extended mode pauses the film when there's more to describe, then carries on
No account, no ads, free; every control has a spoken label for VoiceView
```

## Keywords (Step 3, optional, comma-separated)

```
audio description, described video, accessibility, blind, low vision, visually impaired, captions, subtitles, SDH, rich captions, narration, open movies, Blender, Sintel, Big Buck Bunny, free movies
```

## Pricing (Step 3)

**Free.** No in-app items, no ads (no Amazon Mobile Ad Network), so no payment, banking or tax profile is needed for this
app ([Step 3, Pricing](https://developer.amazon.com/docs/app-submission/appstore-details.html)).

## Target audience (Step 2)

**Apps not designed for children (16 and above).** The catalogue is open films that families watch, but Sintel shows
blood and a creature's death (below), and nothing in the app is made for children; picking a children's audience would
also bring the Child-Directed App (COPPA) Policy into scope
([Step 2, Target audience](https://developer.amazon.com/docs/app-submission/target-app.html)).

## Content rating questionnaire (Step 2)

The console asks about these categories
([Step 2, Content rating](https://developer.amazon.com/docs/app-submission/target-app.html)); pick the level labels the
console offers. Evidence: the published captions and description tracks of all six titles (`captions.vtt`,
`descriptions.vtt` on CloudFront, read 2026-10-22) and the screens captured for this listing.

| Category | Answer | Why |
|---|---|---|
| Violence (realistic) | **Mild / infrequent** | Tears of Steel (live action, 0:40–1:40): soldiers aim rifles ("Man in dark jacket aims rifle from balcony", "A woman aims a futuristic rifle") and "Figure kneels beside prone bodies"; no shooting or wounds are described in the segment. |
| Cartoon / fantasy violence | **Mild / infrequent** (the lowest level above None) | Sintel (animated, whole film): sword and staff fights ("The young woman fights a bald man", "she dodges… a dark grey dragon lunges"), a baby dragon with a bleeding wing and blood pooling beside it (≈ 3:3x, seen in capture), and a dragon's death at the end. Caminandes: slapstick with an electric fence. Elephants Dream: peril in a machine. No gore. If the console has no separate "fantasy" level, use it under Violence instead and keep "Mild". |
| Drugs | None | Nothing in any title. |
| Nudity | None | Nothing in any title. |
| Sex | None | Nothing in any title. |
| Intolerance | None | Nothing in any title. |
| Profanity | None | Searched all six caption tracks for common profanity: no match. |
| Academic | No | Not an educational app. |
| Account creation or other personal information collected | **No account.** Answer Yes only if the console counts a device identifier as personal information; the User data privacy section below declares it either way. | The app sends a key made from the Android ID (see [privacy.md](../privacy.md)). |
| Advertisements | No | No ad SDK, no ads. |
| Gambling | No | — |
| Location detection / location-based services | No | No location permission or lookup. |
| User-generated content / user-to-user communication | No | The catalogue is fixed; users cannot post or message. |

## User data privacy (Step 2)

| Question | Answer |
|---|---|
| Does your app collect user data or transfer user data to third parties? | **Yes** (a device-derived key, settings, My list and resume points are stored on the service) |
| Privacy policy URL | `https://github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md` (live once this PR is merged to main) |
| Data types | Device or other IDs (the `fireos-<Android ID>` key); App activity / in-app actions (My list, resume points, settings). Diagnostics only for failed requests (error log lines, 7 days). |
| Purpose | App functionality only. Not used for advertising, analytics, tracking or profiling. |
| Shared with third parties | No. AWS hosts the service as a processor. |
| Encrypted in transit | Yes (HTTPS to the Lambda function URL and CloudFront). |
| Can users request deletion? | Yes — link: `https://github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md#delete-your-data` |
| Account deletion | Not applicable (no accounts). |

Questionnaire background: [Appstore Privacy Labels](https://developer.amazon.com/docs/app-submission/appstore-privacy-labels.html),
[User Account and Data Deletion](https://developer.amazon.com/docs/app-submission/user-account-and-data-deletion.html).

## Target devices (Step 2)

**Fire TV only.** Clear every Fire tablet and Amazon Automotive device under *Edit supported devices*. The APK carries
arm64-v8a and armeabi-v7a (and x86, x86_64), so 32-bit and 64-bit-only Fire TV devices are both covered
([Step 2, Supported devices](https://developer.amazon.com/docs/app-submission/target-app.html)). The upload is likely to
show no compatible Fire TV device until the manifest is fixed — see [SUBMIT.md](SUBMIT.md), blocker B1.

## Images (Step 3)

Final upload set in `~/Downloads/described-devpost/appstore/` (`art/`, `screens/`); sources in the repo.

| Console slot | Spec (Amazon) | File |
|---|---|---|
| Tablet › Small icon | 114 × 114 PNG (transparent) | `art/described-icon-114.png` (repo: `apps/expo/assets/store/`) |
| Tablet › Large icon | 512 × 512 PNG (transparent) | `art/described-icon-512.png` |
| Tablet › Screenshots | 3–10, 1920 × 1080 is an allowed size, PNG or JPEG | same nine files as Fire TV screenshots |
| Fire TV › App icon | 1280 × 720 PNG, no transparency; main subject inside 882 × 448 | `art/described-firetv-1280x720.png` (flattened to RGB in this PR) |
| Fire TV › Screenshots | 3–10, 1920 × 1080 landscape, JPG or 24-bit PNG, no transparency | `screens/01-home.png` … `screens/09-about.png` (repo: `docs/screens/`) |
| Fire TV › Background image | 1920 × 1080, JPG or 24-bit PNG, no transparency; subject on the right inside 1214 × 830; no logos or titles | **Missing — required.** See [SUBMIT.md](SUBMIT.md), decision D4. |

Screenshot order (logical progression, as Amazon's best practices ask): Home → Title → Player with rich captions →
Extended mode pause → Audio & captions sheet → Settings → Home with the rail open → First run → About & licenses.
