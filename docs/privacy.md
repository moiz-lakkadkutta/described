# Described — privacy policy

Last updated: 22 October 2026. Applies to the Described app for Fire TV (package `dev.moizp.described`) and the hosted
service it talks to. Public URL: https://github.com/moiz-lakkadkutta/described/blob/main/docs/privacy.md

## The short version

You don't make an account, and there are no ads and no analytics. To remember your settings, My list and where you
stopped watching, the app sends one key made from your device's Android ID. That's all it stores about you.

## What the app sends

| What | When | Why |
|---|---|---|
| A device key: `fireos-` followed by your device's Android ID | With every request to the Described service (the `x-device-id` header) | To keep your settings, My list and resume points apart from other devices'. Android gives each app its own Android ID per device, user and signing key, so the key is not shared with other apps. |
| Your settings: description on by default, voice, Extended mode, caption kind, caption size, caption style, whether you've seen the introduction | When you change a setting | So the app opens the way you left it. |
| My list: the titles you save | When you add or remove a title | To show My list. |
| Resume points: how far into a title you got (in seconds) | While you watch | To offer "Continue watching" and resume where you stopped. |

The app does not ask for your name, email, location, contacts or voice. It has no account, no sign-in, no advertising
SDK, no analytics or crash-reporting SDK, and no in-app purchases. (Checked in the code: `apps/expo/src/deviceId.ts`,
`packages/shared-ui/src/index.tsx`, `apps/api/src/routes/me.ts`, `apps/api/prisma/schema.prisma`.)

The Android package declares a microphone permission (`RECORD_AUDIO`) because a media library adds it by default; the app
never records audio. Pressing the microphone button on the remote talks to Alexa, which Amazon handles under its own
privacy notice, not to Described.

## What the service sees and keeps

| Data | Where | How long |
|---|---|---|
| Device key, settings, My list, resume points | Amazon RDS for PostgreSQL, AWS region us-east-1 (N. Virginia) | Until you ask us to delete it, or until the hosted service is shut down, whichever is first. Database backups are kept for 1 day. |
| Failed requests only (an error or a "not found"): time, path, status, request headers — which include the device key and your device's user agent — and the network address the request came from | Amazon CloudWatch Logs, us-east-1 | 7 days, then deleted automatically. Successful requests are not logged. |
| Film video, audio, captions and narration clips | Served by Amazon CloudFront from Amazon S3 (eu-central-1). Like any web server, CloudFront receives your network address to deliver the files. | Described does not turn on CloudFront access logs, so it keeps no record of these requests. |

Nothing is sold, rented or shared with anyone. Amazon Web Services hosts the service on our behalf. The films' audio
description is made in advance; watching a film sends nothing to a description or voice service.

Data travels over HTTPS.

## Delete your data

Open an issue at https://github.com/moiz-lakkadkutta/described/issues titled **Delete my data**. Issues are public:
don't post your name, email or any device details. Because there are no accounts and the app does not show your device
key, we can't pick out your rows from others'. So when you ask, we delete **every** viewer's stored settings, My list
and resume points (all devices), reply on the issue, and close it within 30 days. Nothing else about you is stored to
delete. Afterwards the app starts with default settings and an empty My list.

You can also remove titles from My list in the app at any time, and uninstalling the app stops it sending anything.

When the hosted service is shut down, its database, backups and logs are deleted with it. The judging copy runs as the
`dev` stage, where that is the whole story. A `prod`-stage deploy is different: it keeps a final snapshot of the database
when the stack is removed (`infra/lib/viewer-stack.ts`), and that snapshot has to be deleted by hand.

## Children

Described is not made for children and does not knowingly collect anything from them beyond the device key above.

## Changes

If this policy changes, the new version replaces this page and the date at the top changes. The history of every change
is public in the repository: https://github.com/moiz-lakkadkutta/described/commits/main/docs/privacy.md

## Contact

Questions about this policy: https://github.com/moiz-lakkadkutta/described/issues
