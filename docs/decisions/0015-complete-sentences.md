# 0015 — Narration is complete sentences: articles, a verb, a capital letter and a full stop

Status: proposed 2026-10-15 (human approved one text-quality round before the next Gate C)
Ticket: DESC-033 · Follows: 0003 (Gate C), 0010 (verify pass), 0011 (fit shortener sentences), 0013 (legible text)

## Problem

Gate C g11 failed narrowly — sintel-90-210 19 / 29 and the held-out Tears of Steel 6:30–8:30 20 / 30, against a bar of 21 — and
most fails were text quality, not wrong facts:

- dropped articles: "Man holds staff.", "Small tan dragon bleeds on rooftop.", "… climbs rooftop";
- a lowercase start with no full stop: "a young woman with short red hair, in a grey tank top, in brown trousers climbs rooftop";
- verbless lines: "A man's face pressed against a mechanical device.", "Ornate clock tower with golden dials, debris flying.",
  "Dim, smoky chamber with glowing lines.";
- a misread quote kept by verify: `Words appear: "CULP, I LOVE YOUR HAND"` where the frames show "CELIA, I LOVE YOUR … HAND", partly hidden.

verify.json of both runs shows the verify pass returned almost every telegraphic draft unchanged: its prompt told it to return the
draft unchanged when every detail is visible, so it never added the articles it was allowed to add.

## Decision

1. **Describe prompt** (prompts.ts, `COMPLETE_SENTENCES_RULE`, one line after the present-tense rule): "Write complete
   present-tense sentences: each has a verb and its articles ("a", "the"), starts with a capital letter and ends with a full stop."
   No example sentence — only single words are quoted (a quoted sentence is one the model copies). `DESCRIBE_CACHE_VERSION` 3.
2. **Verify prompt** (verifyPrompt.ts): "Write complete sentences with articles and a verb … to fix the grammar you may add only
   a, an, the, is, are (German: the articles, ist, sind), even when every detail is visible", and the draft is returned unchanged
   only when it is already complete sentences. The word cap line says the added grammar words do not count. The text-clause rule
   gains: any doubt about any letter, or any word even partly hidden, means the whole clause becomes "Words appear." /
   "Text erscheint.". `VERIFY_PROMPT_VERSION` 5.
3. **Verify guard** (04b-verify `checkVerified`): articles and is / are were already free linking words, so "Man holds staff." →
   "A man holds a staff." and "A man's face pressed …" → "A man's face is pressed …" pass. New: a **pure grammar fix** — a reply
   whose only added words are `GRAMMAR` words (a, an, the, is, are; der … eines, ist, sind), no other linking word and no
   "visible" — may go past the shot's word cap by those words, up to `MAX_ADDED_WORDS` (3) over the draft, so a draft already at
   its budget can still become a sentence. Every other guard is unchanged: no new content word, no has / have, names, negations
   and protected words kept, order kept, on-screen text kept or replaced whole. Any other reply keeps the cap.
   **An is / are never fills a deleted word** (PR #61 review): "Man holds staff." → "Man is staff." / "A man is a staff." would
   be a false claim. Positional, no part-of-speech tagging (04b-verify `copulaFills`): for each is / are (ist / sind) in the reply,
   take the nearest aligned reply words before and after it (for a copula the draft has too, from its own draft position); a draft
   word between them that is neither a linking word nor kept means the copula stands in a deleted word's place, and the reply is
   rejected (`"is" added in place of a deleted word`, or `kept …`). A sentence that ends in a copula ("A woman is.") is always
   rejected.

   One exception: the copula's next word other than an article is "visible" (its own guard) or a **place word** — with, in, on,
   under, near, beside, behind, inside, outside, above, below, beneath, across, against, among, amid, between, into, onto,
   through, around; German mit, in, im, auf, unter, neben, hinter, vor, zwischen, innerhalb, außerhalb. "X is in / on / with Y"
   says where X is, which the draft said too, so decision 0010's approved deletions stay: "The woman … blinks slowly in dim
   light." → "The woman … is in dim light.", "Red-haired girl reads book." → "A red-haired girl is with a creature.". The list
   leaves out **at, by, over** (German **an, am, bei, über**) on purpose: they usually belong to the action, so the deleted
   action becomes a false place — "The man points at the door." → "The man is at the door.", "The girl is attacked by the
   dragon." → "The girl is by the dragon.", "Der Mann klopft an die Tür." → "Der Mann ist an der Tür." are all rejected.
4. **polishCue(text, language)** (packages/pipeline/src/polishCue.ts, pure): collapses spaces (none before , . ; : ! ?),
   capitalises the first letter of each sentence in the language's locale, and makes the cue end with . ! or ? (a trailing , ; :
   dash or ellipsis becomes a full stop; after a closing quote the full stop goes outside it, unless the quote itself ends with
   . ! ? or …). Quoted text and the text of every on-screen text clause are never touched. It never changes a word. It does not
   capitalise after an ellipsis or an abbreviation ("e.g. a hammer") and adds nothing inside an unclosed quote. Called in two
   places: 06-voice, on the text sent to Polly — the clip sidecar's `ssml` key is the polished text, so a clip voiced before this
   decision is voiced again once (the stored cue text stays unpolished) — and 08-text, on the text written to descriptions.vtt.

## Not changed

05-fit's shortener (article-keeping), sentenceGuard, 04c scenes and 05b-edit belong to the scene / fit / voice work running in
parallel and are not touched here. The DescriptionCue rows the API serves are written from cues.json, so their text is not
polished; the app reads descriptions.vtt and the audio, which are.

## Consequences

- The next Gate C re-runs describe (cache version 3) and verify (prompt version 5) on both clips; about 60 Qwen3-VL calls each.
- A clip voiced before this decision is voiced again on the next run (its sidecar key is the unpolished SSML): a Polly cost
  only, once.
