import { personalization } from '@moizp/vega-media-kit/platform'
import type { PlaybackReporter } from '@described/shared-ui'

/**
 * Watch activity for Fire TV's "continue watching" row (DESC-008). On Fire OS that is the Fire TV Integration SDK
 * (AmazonPlaybackReceiver.addPlaybackEvent), which needs catalog integration first — Fire TV must recognise the
 * content IDs — plus the SDK jar from Amazon and a data integration service. Not before the freeze
 * (docs/platform/fire-os-bindings.md §3). Until then this forwards to the kit's personalization binding, a logged
 * no-op on Fire OS, so the events and their shape are already in place. Our own resume points are Root's
 * PUT /me/progress, unaffected.
 */
export const playbackReporter: PlaybackReporter = {
  report(e) {
    void personalization.reportPlayback(e.slug, e.positionS, e.durationS ?? 0)
  },
}
