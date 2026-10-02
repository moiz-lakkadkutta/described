import React, { useState } from 'react'
import { View } from 'react-native'
import { SpatialNavigationNode } from 'react-tv-space-navigation'
import { Focusable, T } from '../components'
import type { CaptionKind } from '../playback'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export type SheetItem = 'original' | 'ad' | `cap:${CaptionKind}` | 'extended'
export interface TrackSheetProps {
  voice: string; adOn: boolean; captionKind: CaptionKind; extendedMode: boolean
  /** Focus lands here when the sheet opens: the item focused when it last closed, else the audio in use. */
  initial?: SheetItem
  onAudio: (ad: boolean) => void; onCaptions: (kind: CaptionKind) => void; onExtended: (on: boolean) => void
  onFocusItem: (id: SheetItem) => void
}

const S = strings.tracks
const captionItems: { kind: CaptionKind; text: string; label: string }[] = [
  { kind: 'off', text: S.off, label: S.a11y.off },
  { kind: 'captions', text: S.plain, label: S.a11y.plain },
  { kind: 'sdh', text: S.rich, label: S.a11y.rich },
  { kind: 'descriptions', text: S.descText, label: S.a11y.descText },
]

/**
 * Right-side 640 px panel over the film: Audio (Original · Audio description) and Captions (Off · Captions ·
 * Rich captions · Description text), Extended mode at the foot. One vertical list; Select applies at once.
 * Selected is the teal ring + ✓ (Focusable). Back and Menu close it — Player owns those keys.
 */
export function TrackSheet({ voice, adOn, captionKind, extendedMode, initial, onAudio, onCaptions, onExtended, onFocusItem }: TrackSheetProps) {
  const first: SheetItem = initial ?? (adOn ? 'ad' : 'original')
  // The panel's name rides on the first item's announcement (one utterance; a separate announce would be cut off
  // by the focus announcement). Once focus has moved, items read their own labels only.
  const [named, setNamed] = useState(false)
  const item = (id: SheetItem, text: string, base: string, selected: boolean, onPress: () => void) => {
    const label = !named && id === first ? `${S.heading}. ${base}` : base
    return (
    <Focusable key={id} label={label} selected={selected} defaultFocus={id === first} onFocus={() => { onFocusItem(id); if (id !== first) setNamed(true) }} onPress={onPress} testID={`sheet:${id}`}
      style={{ paddingVertical: px(14), paddingHorizontal: px(24), backgroundColor: tokens.color.surface1 }} focusedStyle={{ backgroundColor: tokens.color.surface3 }}>
      <T variant="body">{text}</T>
    </Focusable>
    )
  }
  const heading = (text: string) => <T variant="label" color={tokens.color.textSecondary} style={{ marginTop: px(24), marginBottom: px(4) }}>{text.toUpperCase()}</T>
  return (
    <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: px(640), backgroundColor: tokens.color.surface1, paddingHorizontal: px(48), paddingVertical: px(tokens.layout.safeY) }}
      accessibilityViewIsModal aria-label={S.heading} testID="track-sheet">
      <SpatialNavigationNode orientation="vertical">
        <View style={{ flex: 1, gap: px(8) }}>
          <T variant="title">{S.heading}</T>
          {heading(S.audio)}
          {item('original', S.original, S.a11y.original, !adOn, () => onAudio(false))}
          {item('ad', S.ad(voice), S.a11y.ad(voice), adOn, () => onAudio(true))}
          {heading(S.captions)}
          {captionItems.map((c) => item(`cap:${c.kind}`, c.text, c.label, captionKind === c.kind, () => onCaptions(c.kind)))}
          <View style={{ marginTop: 'auto' }}>
            {item('extended', `${S.extended} · ${extendedMode ? S.on : S.offState}`, extendedMode ? S.a11y.extendedOn : S.a11y.extendedOff, extendedMode, () => onExtended(!extendedMode))}
          </View>
        </View>
      </SpatialNavigationNode>
    </View>
  )
}
