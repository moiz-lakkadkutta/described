# captioningmanager style has no typeface name and the kit draws no caption edge

Task attempted: DESC-035 — draw Described's captions in the viewer's Fire TV caption style (Settings › Accessibility › Captions) through Android's CaptioningManager.
Steps:
  1. Read CaptioningManager and CaptioningManager.CaptionStyle (isEnabled, getFontScale, getLocale, getUserStyle, the CaptioningChangeListener).
  2. Mapped each field onto the kit's CueTheme (fontFamily, primaryColor, secondaryColor, boxColor, userScale).
Expected: every field of the system style maps onto something we can draw.
Actual:
  - CaptionStyle.getTypeface() returns a Typeface object, not a family name; React Native needs a name. The module matches it by identity against Typeface.create(family, NORMAL) for the families Android's caption settings offer — works when the framework's cache returns the same object, unverified on Fire OS.
  - Edge type (outline, drop shadow, raised, depressed) and edge colour have nowhere to go: the kit's CueTheme has no text shadow or outline (the same gap as the app's own "Shadow" style, TODO(kit)). Edges are read and passed to JS but not drawn; a style with a clear background keeps a box, raised to the contrast floor.
  - Android has a background colour (behind the text) and a window colour (behind the block); the kit draws one box. We use the background, or the window when the background is clear.
  - The CaptionStyle "unset" sentinels are hidden constants; only hasXxxColor() tells them apart.
  - The Nov 2025 Amazon accessibility guide lists caption style customisation for Fire tablets only, so it is not documented whether every Fire TV build exposes all CaptionStyle fields — needs the device check.
Severity: Low — about 30 minutes; captions still follow colours, size and family.
Workaround: as above; the contrast clamp keeps every system colour pair readable (tokens.contrast.min, 4.5:1, over the darkest and brightest picture).
Suggestion: kit — add textShadow / textStroke to CueTheme and a windowColor. Android — a public CaptionStyle.getTypefaceName().
Environment: Expo SDK 54, React Native 0.81, @moizp/vega-media-kit 0.1.0-alpha, Android API 28 (Fire OS 7)
Links: https://developer.android.com/reference/android/view/accessibility/CaptioningManager · https://developer.android.com/reference/android/view/accessibility/CaptioningManager.CaptionStyle · https://developer.amazon.com/apps-and-games/blogs/2025/11/guide-to-accessibility-on-amazon-fire-devices · apps/expo/modules/described-captioning
