import React from 'react'
import { View } from 'react-native'
import { SpatialNavigationScrollView } from 'react-tv-space-navigation'
import type { About as AboutData } from '@described/contracts'
import { Focusable, T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'
import { focusBleed } from '../layout'

const A = strings.about
const L = tokens.layout
const gap = 12
/** Room above the top line for its focus outline and 1.04 growth (the scroll view clips); sized for a two-line sentence. */
const padY = focusBleed(2 * tokens.type.body.line + 2 * gap)
/**
 * Where a focused line lands below the scroll view's top: under a section label (FILMS / SOFTWARE). The first line sits
 * exactly there, so focusing it does not scroll and the FILMS label stays in view.
 */
const lead = padY + tokens.type.label.line + gap
/**
 * About & licenses: each title's attribution sentence, then the font and code licenses. Every sentence is a focusable
 * line, so ▲▼ walks the list and VoiceView reads each one; nothing happens on Select. Close (or Back) returns to Settings.
 * `about`: null while loading, 'offline' when the list could not be fetched (the licenses still show).
 */
export function About({ about, onClose }: { about: AboutData | null | 'offline'; onClose: () => void }) {
  const line = (key: string, text: string, first = false) => (
    <Focusable key={key} label={text} role="text" defaultFocus={first} style={{ paddingVertical: px(gap), paddingHorizontal: px(24) }} focusedStyle={{ backgroundColor: tokens.color.surface2 }}>
      <T variant="body">{text}</T>
    </Focusable>
  )
  const films = about && about !== 'offline' ? about.titles : []
  const status = about === null ? A.loading : about === 'offline' ? A.unavailable : null
  return (
    <View style={{ flex: 1 }}>
      {/* The heading sits above the scroll view, like the Grid heading (#30): a focus scroll puts the focused line `lead`
          below the scroll view's top, which pushed a heading inside it out of view (DESC-023). */}
      <T variant="title" style={{ marginBottom: px(Math.max(0, L.headingGap - padY)) }}>{A.heading}</T>
      <SpatialNavigationScrollView useNativeScroll offsetFromStart={px(lead)}>
        <View style={{ gap: px(gap), maxWidth: px(1300), paddingTop: px(padY), paddingBottom: px(padY) }}>
          <T variant="label" color={tokens.color.textSecondary}>{A.films.toUpperCase()}</T>
          {status ? <View accessibilityLiveRegion="polite"><T variant="body" color={tokens.color.textSecondary} style={{ paddingHorizontal: px(24) }}>{status}</T></View> : null}
          {/* Nothing focusable while loading (Root locks the D-pad), so focus lands once, on the first line. */}
          {about === null ? null : <>
            {films.map((f, i) => line(`film:${f.slug}`, f.attribution, i === 0))}
            <T variant="label" color={tokens.color.textSecondary} style={{ marginTop: px(24) }}>{A.software.toUpperCase()}</T>
            {A.licenses.map((l, i) => line(`license:${i}`, l, !films.length && i === 0))}
            <Focusable label={strings.a11y.closeAbout} role="button" onPress={onClose} style={{ alignSelf: 'flex-start', marginTop: px(24), backgroundColor: tokens.color.surface2, paddingHorizontal: px(28), paddingVertical: px(gap) }} focusedStyle={{ backgroundColor: tokens.color.surface3 }}>
              <T variant="body">{A.close}</T>
            </Focusable>
          </>}
        </View>
      </SpatialNavigationScrollView>
    </View>
  )
}
