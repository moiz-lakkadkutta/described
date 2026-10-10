package dev.moizp.described.mediasession

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Bundle
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
 * Fire TV delivers "fast forward" and "rewind" as `onSeekTo(pos)` (the doc's table: ACTION_SEEK_TO, 10 s unless a
 * duration is said), computed from the position this session reports, and "restart" as `onSeekTo(0)`. onFastForward /
 * onRewind stay mapped for other controllers.
 *
 * Media buttons: Alexa may arrive as MEDIA_PLAY / MEDIA_PAUSE / MEDIA_STOP key events. Those go through the default
 * mapping (super → onPlay / onPause / onStop); while the session is active the JS key path skips those key codes
 * (apps/expo/src/platform/mediaSession.ts `ownsKey`), so the session is their one handler. PLAY_PAUSE, FAST_FORWARD
 * and REWIND are relative — the Player's key handling owns them — so they are swallowed here and reported as control
 * "button" (JS ignores those unless `acceptButtons`, which moves them to the session and off the key path).
 *
 * Visibility: the session goes inactive when the activity is no longer visible (`onActivityStopped`: Home, another
 * app; Alexa must not "pause" a hidden app) and active again when it is (`onActivityStarted`) if the Player still holds
 * it. Not on `onPause`: during a voice interaction Fire TV pauses the activity under the Alexa UI, and Fire TV's
 * media-session publisher (`whad`) unpublishes an inactive session at once — a directive that arrives while it is
 * unpublished (SeekTo: fast forward, rewind, go to) finds no session and is dropped, while Pause / Play, sent as media
 * keys, still reach the last media-button session. Each re-activation also shows up as a "New Session" in `whad`'s
 * log (device run check 14: 13 of them in one playback). Fire OS user builds drop Log.d, so every line here is Log.i.
 * Logcat: `adb logcat -s DescribedMediaSession`.
 */
class DescribedMediaSessionModule : Module() {
  private var session: MediaSession? = null
  /** True once OnDestroy ran: queued main-thread work and late callbacks must not touch the session or emit. */
  @Volatile private var destroyed = false
  /** The activity is started (visible, possibly paused under a dialog or the Alexa UI). True until told otherwise. */
  @Volatile private var visible = true
  private var startedActivities = 0
  private var application: Application? = null
  private val main = Handler(Looper.getMainLooper())

  /** onStart / onStop of this app's activities (registered on its Application; the callbacks run on the main thread). */
  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) {
      startedActivities += 1
      setVisible(true, "started")
    }
    override fun onActivityStopped(activity: Activity) {
      startedActivities = maxOf(0, startedActivities - 1)
      if (startedActivities == 0) setVisible(false, "stopped")
    }
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
  }

  override fun definition() = ModuleDefinition {
    Name("DescribedMediaSession")
    Events("onTransport", "onSessionState")

    OnCreate {
      val app = runCatching { appContext.reactContext?.applicationContext as? Application }.getOrNull()
        ?: runCatching { appContext.currentActivity?.application }.getOrNull()
      if (app == null) Log.w(TAG, "no Application: visibility falls back to pause / resume")
      else { app.registerActivityLifecycleCallbacks(lifecycle); application = app }
    }
    /** durationS ≤ 0 means unknown. Call on every play/pause/seek; the system extrapolates position while playing. */
    Function("setNowPlaying") { title: String, durationS: Double, positionS: Double, playing: Boolean ->
      main.post { update(title, durationS, positionS, playing) }
      Unit
    }
    Function("release") {
      main.post { release() }
      Unit
    }
    // onPause / onResume. With the lifecycle callbacks these only log (the Alexa UI pauses the activity: the session
    // stays active and published); without them they are the visibility signal, as before.
    OnActivityEntersBackground {
      if (application != null) main.post { Log.i(TAG, "activity paused, still visible: session ${if (session?.isActive == true) "stays active" else "as is"}") }
      else setVisible(false, "paused")
    }
    OnActivityEntersForeground {
      if (application != null) Log.i(TAG, "activity resumed")
      else setVisible(true, "resumed")
    }
    OnDestroy {
      destroyed = true
      application?.unregisterActivityLifecycleCallbacks(lifecycle); application = null
      main.post { release() }
    }
  }

  private fun setVisible(now: Boolean, why: String) {
    visible = now
    main.post {
      if (destroyed) return@post
      val s = session ?: return@post
      if (now && !s.isActive) { s.isActive = true; Log.i(TAG, "session active (activity $why)"); emitState(true) }
      if (!now && s.isActive) { s.isActive = false; Log.i(TAG, "session inactive (activity $why)"); emitState(false) }
    }
  }

  private fun emit(control: String, positionS: Double? = null, keyCode: Int? = null) {
    if (destroyed) return
    Log.i(TAG, "transport control=$control positionS=$positionS keyCode=$keyCode")
    val body = mutableMapOf<String, Any?>("control" to control)
    if (positionS != null) body["positionS"] = positionS
    if (keyCode != null) body["keyCode"] = keyCode
    runCatching { sendEvent("onTransport", body) }.onFailure { Log.w(TAG, "transport dropped: ${it.message}") }
  }

  /**
   * Whether a session exists and is active, so JS only takes media keys off the key path when this side can really
   * handle them (ensure() can return null; the activity can be hidden).
   */
  private fun emitState(active: Boolean) {
    if (destroyed) return
    runCatching { sendEvent("onSessionState", mapOf("active" to active)) }.onFailure { Log.w(TAG, "state dropped: ${it.message}") }
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
          Log.i(TAG, "media button ${key.keyCode} action=${key.action} → default mapping")
          return super.onMediaButtonEvent(mediaButtonIntent)
        }
        if (key.action == KeyEvent.ACTION_DOWN && key.repeatCount == 0) emit("button", keyCode = key.keyCode)
        return true
      }
    }, main)
    Log.i(TAG, "session created")
    session = s
    return s
  }

  private fun update(title: String, durationS: Double, positionS: Double, playing: Boolean) {
    if (destroyed) return
    val s = ensure()
    if (s == null) {
      Log.w(TAG, "no session (no React context)")
      emitState(false)
      return
    }
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
    Log.i(TAG, "now playing: $title ${if (playing) "playing" else "paused"} at ${positionS}s")
    if (visible && !s.isActive) {
      s.isActive = true
      Log.i(TAG, "session active: $title")
      emitState(true)
    }
  }

  private fun release() {
    val s = session ?: return
    session = null
    s.isActive = false
    s.release()
    Log.i(TAG, "session released")
    emitState(false)
  }

  companion object {
    private const val TAG = "DescribedMediaSession"
    /** Idempotent keys (Alexa may send these): the framework maps them to onPlay / onPause / onStop. */
    private val DEFAULT_MAPPED = setOf(KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_STOP)
    private val ACTIONS: Long = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
      PlaybackState.ACTION_STOP or PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND or PlaybackState.ACTION_SEEK_TO
  }
}
