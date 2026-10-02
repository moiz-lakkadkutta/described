package dev.moizp.described.mediasession

import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android MediaSession for the Player (DESC-008), so Fire TV routes Alexa transport commands ("Alexa, pause",
 * "resume", "fast forward", "rewind", "go to 5 minutes") to Described — near-field (remote mic) and far-field (Echo).
 * https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html
 *
 * The session only reports: every request goes to JS as an `onTransport` event and JS drives the kit's player, the
 * same calls the remote makes. The session never touches ExoPlayer, so the kit's paused/playing state stays the truth.
 *
 * Media buttons: Alexa may arrive as MEDIA_PLAY / MEDIA_PAUSE / MEDIA_STOP key events. Those go through the default
 * mapping (super → onPlay / onPause / onStop); while the session is active the JS key path skips those key codes
 * (apps/expo/src/platform/mediaSession.ts `ownsKey`), so the session is their one handler. PLAY_PAUSE, FAST_FORWARD
 * and REWIND are relative — the Player's key handling owns them — so they are swallowed here and reported as control
 * "button" (JS ignores those unless `acceptButtons`, which moves them to the session and off the key path).
 *
 * Background: the session goes inactive when the activity leaves the foreground (Alexa must not "pause" a hidden app)
 * and active again on return if the Player still holds it. Logcat: `adb logcat -s DescribedMediaSession`.
 */
class DescribedMediaSessionModule : Module() {
  private var session: MediaSession? = null
  /** True once OnDestroy ran: queued main-thread work and late callbacks must not touch the session or emit. */
  @Volatile private var destroyed = false
  @Volatile private var foreground = true
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("DescribedMediaSession")
    Events("onTransport")

    /** durationS ≤ 0 means unknown. Call on every play/pause/seek; the system extrapolates position while playing. */
    Function("setNowPlaying") { title: String, durationS: Double, positionS: Double, playing: Boolean ->
      main.post { update(title, durationS, positionS, playing) }
      Unit
    }
    Function("release") {
      main.post { release() }
      Unit
    }
    OnActivityEntersBackground {
      foreground = false
      main.post { session?.let { if (it.isActive) { it.isActive = false; Log.d(TAG, "session inactive (background)") } } }
    }
    OnActivityEntersForeground {
      foreground = true
      main.post { if (!destroyed) session?.let { if (!it.isActive) { it.isActive = true; Log.d(TAG, "session active (foreground)") } } }
    }
    OnDestroy {
      destroyed = true
      main.post { release() }
    }
  }

  private fun emit(control: String, positionS: Double? = null, keyCode: Int? = null) {
    if (destroyed) return
    Log.d(TAG, "transport control=$control positionS=$positionS keyCode=$keyCode")
    val body = mutableMapOf<String, Any?>("control" to control)
    if (positionS != null) body["positionS"] = positionS
    if (keyCode != null) body["keyCode"] = keyCode
    runCatching { sendEvent("onTransport", body) }.onFailure { Log.w(TAG, "transport dropped: ${it.message}") }
  }

  private fun ensure(): MediaSession? {
    session?.let { return it }
    if (destroyed) return null
    val context = runCatching { appContext.reactContext }.getOrNull() ?: return null
    val s = MediaSession(context, TAG)
    @Suppress("DEPRECATION") // flags are always on from API 26; Fire OS 6 (API 25) still reads them
    s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
    s.setCallback(object : MediaSession.Callback() {
      override fun onPlay() { emit("play") }
      override fun onPause() { emit("pause") }
      override fun onStop() { emit("stop") }
      override fun onFastForward() { emit("fastForward") }
      override fun onRewind() { emit("rewind") }
      override fun onSeekTo(pos: Long) { emit("seekTo", positionS = pos / 1000.0) }
      override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
        @Suppress("DEPRECATION")
        val key: KeyEvent? = mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
        if (key == null) return super.onMediaButtonEvent(mediaButtonIntent)
        if (key.keyCode in DEFAULT_MAPPED) {
          Log.d(TAG, "media button ${key.keyCode} action=${key.action} → default mapping")
          return super.onMediaButtonEvent(mediaButtonIntent)
        }
        if (key.action == KeyEvent.ACTION_DOWN && key.repeatCount == 0) emit("button", keyCode = key.keyCode)
        return true
      }
    }, main)
    Log.d(TAG, "session created")
    session = s
    return s
  }

  private fun update(title: String, durationS: Double, positionS: Double, playing: Boolean) {
    if (destroyed) return
    val s = ensure() ?: return
    val meta = MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
    if (durationS > 0) meta.putLong(MediaMetadata.METADATA_KEY_DURATION, (durationS * 1000).toLong())
    s.setMetadata(meta.build())
    s.setPlaybackState(
      PlaybackState.Builder()
        .setActions(ACTIONS)
        .setState(
          if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          (positionS * 1000).toLong(),
          if (playing) 1f else 0f,
          SystemClock.elapsedRealtime(),
        )
        .build(),
    )
    if (foreground && !s.isActive) {
      s.isActive = true
      Log.d(TAG, "session active: $title")
    }
  }

  private fun release() {
    val s = session ?: return
    session = null
    s.isActive = false
    s.release()
    Log.d(TAG, "session released")
  }

  companion object {
    private const val TAG = "DescribedMediaSession"
    /** Idempotent keys (Alexa may send these): the framework maps them to onPlay / onPause / onStop. */
    private val DEFAULT_MAPPED = setOf(KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_STOP)
    private val ACTIONS: Long = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
      PlaybackState.ACTION_STOP or PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND or PlaybackState.ACTION_SEEK_TO
  }
}
