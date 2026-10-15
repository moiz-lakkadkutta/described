package dev.moizp.described.captioning

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class CaptionSnapshotTest {
  private val yellow = 0xFFFFFF00.toInt()
  private val black = 0xFF000000.toInt()

  @Test fun fullStyle() {
    val m = CaptionSnapshot.toMap(true, 1.5f, "en-US", yellow, black, 0, 2, black, "serif")
    assertEquals(
      mapOf("enabled" to true, "fontScale" to 1.5, "locale" to "en-US", "foregroundColor" to yellow, "backgroundColor" to black,
        "windowColor" to 0, "edgeType" to 2, "edgeColor" to black, "typeface" to "serif"),
      m,
    )
  }

  @Test fun unsetValuesAreAbsent() {
    val m = CaptionSnapshot.toMap(false, 1f, null, null, null, null, CaptionSnapshot.EDGE_TYPE_UNSPECIFIED, black, "")
    assertEquals(mapOf("enabled" to false, "fontScale" to 1.0), m)
  }

  @Test fun edgeColourOnlyWithAKnownEdgeType() {
    assertFalse(CaptionSnapshot.toMap(true, 1f, null, null, null, null, 7, black, null).containsKey("edgeColor"))
    assertEquals(0, CaptionSnapshot.toMap(true, 1f, null, null, null, null, 0, null, null)["edgeType"])
  }

  @Test fun badScaleIsNormal() {
    assertEquals(1.0, CaptionSnapshot.scale(Float.NaN), 0.0)
    assertEquals(1.0, CaptionSnapshot.scale(0f), 0.0)
    assertEquals(1.0, CaptionSnapshot.scale(Float.POSITIVE_INFINITY), 0.0)
    assertEquals(0.25, CaptionSnapshot.scale(0.25f), 0.0)
  }

  @Test fun colourOnlyWhenTheStyleHasIt() {
    assertEquals(yellow, CaptionSnapshot.colorIf(true, yellow))
    assertNull(CaptionSnapshot.colorIf(false, yellow))
  }

  @Test fun typefaceByIdentity() {
    val default = Any(); val serif = Any(); val mono = Any()
    val families = listOf("serif" to serif, "monospace" to mono, "casual" to null)
    assertEquals("serif", CaptionSnapshot.typefaceName(serif, default, families))
    assertEquals("monospace", CaptionSnapshot.typefaceName(mono, default, families))
    assertNull(CaptionSnapshot.typefaceName(default, default, families))
    assertNull(CaptionSnapshot.typefaceName(null, default, families))
    assertNull(CaptionSnapshot.typefaceName(Any(), default, families)) // unknown: the app font
  }
}
