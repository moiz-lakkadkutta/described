package dev.moizp.described.captioning

import android.content.Context
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.CaptioningManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * The viewer's system caption settings (DESC-035) — on Fire TV, Settings › Accessibility › Captions — read through
 * Android's CaptioningManager: isEnabled, getFontScale, getLocale, getUserStyle (foreground, background and window
 * colours, edge type and colour, typeface). Changes are pushed as `onCaptioningChange` with the full state, from a
 * CaptioningChangeListener registered while JS listens.
 * https://developer.android.com/reference/android/view/accessibility/CaptioningManager
 * https://developer.android.com/reference/android/view/accessibility/CaptioningManager.CaptionStyle
 *
 * This module only reads. What to do with the values (precedence over the app's own caption style, contrast floor,
 * size limits) is decided in shared-ui (platform/captioning.ts). Logcat: `adb logcat -s DescribedCaptioning`
 * (Log.i: Fire OS user builds drop Log.d).
 */
class DescribedCaptioningModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var listener: CaptioningManager.CaptioningChangeListener? = null
  /** The manager the listener was registered on: stop() unregisters through it, even if the React context is gone by then. */
  private var registeredOn: CaptioningManager? = null

  private fun manager(): CaptioningManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.CAPTIONING_SERVICE) as? CaptioningManager
  }

  private fun read(): Map<String, Any> {
    val cm = manager() ?: return CaptionSnapshot.toMap(false, 1f, null, null, null, null, CaptionSnapshot.EDGE_TYPE_UNSPECIFIED, null, null)
    val s = cm.userStyle
    val families = CaptionSnapshot.FAMILIES.map { it to runCatching { Typeface.create(it, Typeface.NORMAL) }.getOrNull() }
    return CaptionSnapshot.toMap(
      enabled = cm.isEnabled,
      fontScale = cm.fontScale,
      locale = cm.locale?.let(Locale::toLanguageTag),
      foregroundColor = CaptionSnapshot.colorIf(s.hasForegroundColor(), s.foregroundColor),
      backgroundColor = CaptionSnapshot.colorIf(s.hasBackgroundColor(), s.backgroundColor),
      windowColor = CaptionSnapshot.colorIf(s.hasWindowColor(), s.windowColor),
      edgeType = if (s.hasEdgeType()) s.edgeType else CaptionSnapshot.EDGE_TYPE_UNSPECIFIED,
      edgeColor = CaptionSnapshot.colorIf(s.hasEdgeColor(), s.edgeColor),
      typeface = CaptionSnapshot.typefaceName(s.typeface, Typeface.DEFAULT, families + ("sans-serif" to Typeface.SANS_SERIF)).takeUnless { it == "sans-serif" },
    )
  }

  private fun emit(why: String) {
    val state = runCatching { read() }.getOrElse { Log.i(TAG, "read failed: $it"); return }
    Log.i(TAG, "change=$why $state")
    sendEvent("onCaptioningChange", state)
  }

  override fun definition() = ModuleDefinition {
    Name("DescribedCaptioning")
    Events("onCaptioningChange")

    Function("get") {
      val state = read()
      Log.i(TAG, "get $state")
      state
    }

    OnStartObserving {
      main.post {
        val cm = manager() ?: return@post
        if (listener != null) return@post
        val l = object : CaptioningManager.CaptioningChangeListener() {
          override fun onEnabledChanged(enabled: Boolean) = emit("enabled")
          override fun onUserStyleChanged(userStyle: CaptioningManager.CaptionStyle) = emit("style")
          override fun onLocaleChanged(locale: Locale?) = emit("locale")
          override fun onFontScaleChanged(fontScale: Float) = emit("fontScale")
        }
        cm.addCaptioningChangeListener(l)
        listener = l
        registeredOn = cm
      }
    }

    OnStopObserving { main.post { stop() } }
    OnDestroy { main.post { stop() } }
  }

  private fun stop() {
    val l = listener ?: return
    val cm = registeredOn
    listener = null
    registeredOn = null
    runCatching { cm?.removeCaptioningChangeListener(l) }
  }

  companion object { private const val TAG = "DescribedCaptioning" }
}
