import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, BackHandler, View } from 'react-native'
import { promptText, type PromptKey } from '@described/contracts'
import { Focusable, T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

export interface FirstRunProps {
  /** Plays the panel's prompt in the app voice (Root decides whether a clip plays; see Root's speakPrompt). */
  speakPrompt: (key: PromptKey) => void
  /** Panel 3 answered: Keep on → true, Turn off → false. */
  onDone: (extendedMode: boolean) => void
  /** Back twice on panel 1: the introduction ends without changing extended mode. */
  onSkip: () => void
}

const panels = strings.firstRun.panels
/**
 * Three panels, one primary action each; no typing, no timers. Select advances; Back goes to the previous panel.
 * On panel 1 the first Back arms a skip (shown and announced), the second skips. Every panel's text is announced to
 * VoiceView and spoken in the app voice as it appears. Handles its own Back: Root leaves `firstRun` to this listener.
 */
export function FirstRun({ speakPrompt, onDone, onSkip }: FirstRunProps) {
  const [i, setI] = useState(0)
  const [armed, setArmed] = useState(false)
  const p = panels[i]!
  const mounted = useRef(false)
  useEffect(() => {
    speakPrompt(p.key)
    // On mount the focused button announces its own label and hint; on later panels the button stays focused, so say it here.
    AccessibilityInfo.announceForAccessibility(mounted.current ? `${promptText[p.key]} ${p.label}. ${p.hint}` : promptText[p.key])
    mounted.current = true
  }, [p, speakPrompt])

  const state = useRef({ i, armed, onSkip })
  state.current = { i, armed, onSkip }
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = state.current
      if (s.i > 0) { setI(s.i - 1); setArmed(false) }
      else if (s.armed) s.onSkip()
      else { setArmed(true); AccessibilityInfo.announceForAccessibility(strings.firstRun.skipArmed) }
      return true // never leaves the app from here
    })
    return () => sub.remove()
  }, [])

  const next = () => { setArmed(false); if (i < panels.length - 1) setI(i + 1); else onDone(true) }
  const button = { paddingHorizontal: px(40), paddingVertical: px(20) }
  return (
    <View style={{ flex: 1, justifyContent: 'center', maxWidth: px(1200), gap: px(28) }}>
      <T variant="label" color={tokens.color.textSecondary}>{strings.firstRun.step(i + 1, panels.length)}</T>
      <T variant="display">{p.title}</T>
      {p.body ? <T variant="heading" color={tokens.color.textSecondary}>{p.body}</T> : null}
      <View style={{ flexDirection: 'row', gap: px(24), marginTop: px(24) }}>
        {/* Same key on every panel: the focused button stays mounted, so focus never drops between panels. */}
        <Focusable key="primary" label={p.label} hint={p.hint} role="button" defaultFocus onPress={next} style={{ ...button, backgroundColor: tokens.color.interactive }}>
          <T variant="heading" color={tokens.color.ground}>{p.cta}</T>
        </Focusable>
        {p.alt ? (
          <Focusable key="alt" label={p.altLabel!} hint={p.altHint} role="button" onPress={() => onDone(false)} style={{ ...button, backgroundColor: tokens.color.surface2 }} focusedStyle={{ backgroundColor: tokens.color.surface3 }}>
            <T variant="heading">{p.alt}</T>
          </Focusable>
        ) : null}
      </View>
      <View accessibilityLiveRegion="polite" style={{ minHeight: px(tokens.type.body.line) }}>
        {armed ? <T variant="body" color={tokens.color.textSecondary}>{strings.firstRun.skipArmed}</T> : null}
      </View>
    </View>
  )
}
