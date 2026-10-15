package dev.moizp.described.captioning

/**
 * What the module sends to JS for one reading of CaptioningManager, from plain values so it can be unit-tested on the
 * JVM. Absent keys mean "unset" (CaptionStyle.hasXxxColor() false, no locale, default typeface); JS maps them to null
 * (apps/expo/src/platform/captioning.ts `fromNative`). Expo's bridge is happier without null map values.
 */
object CaptionSnapshot {
  /** CaptionStyle.EDGE_TYPE_UNSPECIFIED: the style says nothing about edges. */
  const val EDGE_TYPE_UNSPECIFIED = -1
  private const val EDGE_TYPE_MAX = 4 // EDGE_TYPE_DEPRESSED

  fun toMap(
    enabled: Boolean,
    fontScale: Float,
    locale: String?,
    foregroundColor: Int?,
    backgroundColor: Int?,
    windowColor: Int?,
    edgeType: Int,
    edgeColor: Int?,
    typeface: String?,
  ): Map<String, Any> {
    val m = linkedMapOf<String, Any>("enabled" to enabled, "fontScale" to scale(fontScale))
    if (!locale.isNullOrEmpty()) m["locale"] = locale
    foregroundColor?.let { m["foregroundColor"] = it }
    backgroundColor?.let { m["backgroundColor"] = it }
    windowColor?.let { m["windowColor"] = it }
    if (edgeType in 0..EDGE_TYPE_MAX) {
      m["edgeType"] = edgeType
      edgeColor?.let { m["edgeColor"] = it }
    }
    if (!typeface.isNullOrEmpty()) m["typeface"] = typeface
    return m
  }

  /** NaN, infinite or non-positive → 1 (normal size). JS clamps the range. */
  fun scale(f: Float): Double = if (f.isFinite() && f > 0f) f.toDouble() else 1.0

  /** CaptionStyle.hasXxxColor() → the colour, else null. */
  fun colorIf(has: Boolean, color: Int): Int? = if (has) color else null

  /**
   * The Android font family a caption Typeface matches, by identity with Typeface.create(family, NORMAL) — the
   * framework caches those, and CaptionStyle.getTypeface() builds its Typeface the same way from the setting. The
   * system default (null, or the default sans) is null: the app keeps its own caption font.
   */
  fun <T> typefaceName(typeface: T?, default: T?, candidates: List<Pair<String, T?>>): String? {
    if (typeface == null || typeface == default) return null
    return candidates.firstOrNull { (_, t) -> t != null && t == typeface }?.first
  }

  /** Families offered by Android's caption settings (Settings › Captions › Font family), sans-serif excluded. */
  val FAMILIES = listOf("serif", "monospace", "sans-serif-monospace", "serif-monospace", "sans-serif-condensed", "sans-serif-smallcaps", "casual", "cursive")
}
