import React, { useCallback, useRef } from 'react'
import { AccessibilityInfo, View } from 'react-native'
import { useFocusMemory } from '@moizp/vega-media-kit/focus'
import { CaptionStyle, Voice, type Prefs } from '@described/contracts'
import { Focusable, T } from '../components'
import { pickInitialFocus } from '../focus/memory'
import { useKeyHandler } from '../focus/keys'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

const S = strings.settings
const SCALES: Prefs['captionScale'][] = [100, 125, 150, 200]
const step = <V,>(all: readonly V[], cur: V, dir: 1 | -1) => all[(all.indexOf(cur) + dir + all.length) % all.length]!
const onOff = (b: boolean) => (b ? S.on : S.off)

/** A Settings row: a value that ◄► (and Select) steps through, or an action Select runs. */
export interface SettingRow { id: string; name: string; value: string; label: string; hint?: string; step?: (dir: 1 | -1) => Partial<Prefs>; press?: () => void }
export interface SettingsProps {
  prefs: Prefs; onChange: (p: Partial<Prefs>) => void
  onHearVoice: (v: Prefs['voice']) => void; onResetFirstRun: () => void; onAbout: () => void
}

/** Rows in screen order. Values wrap in both directions, so ◄ and ► always do something. */
export function settingsRows({ prefs, onHearVoice, onResetFirstRun, onAbout }: Omit<SettingsProps, 'onChange'>): SettingRow[] {
  const value = (id: string, name: string, v: string, next: (dir: 1 | -1) => Partial<Prefs>): SettingRow =>
    ({ id, name, value: v, label: name, hint: strings.a11y.settingHint, step: next }) // the value is accessibilityValue; Focusable says both
  return [
    value('adDefault', S.adDefault, onOff(prefs.adDefault), () => ({ adDefault: !prefs.adDefault })),
    { ...value('voice', S.voice, prefs.voice, (d) => ({ voice: step(Voice.options, prefs.voice, d) })), hint: strings.a11y.voiceHint },
    { id: 'hearIt', name: S.hearIt, value: prefs.voice, label: strings.a11y.hearVoice(prefs.voice), hint: strings.a11y.hearVoiceHint, press: () => onHearVoice(prefs.voice) },
    value('extended', S.extended, onOff(prefs.extendedMode), () => ({ extendedMode: !prefs.extendedMode })),
    value('capSize', S.capSize, S.scale(prefs.captionScale), (d) => ({ captionScale: step(SCALES, prefs.captionScale, d) })),
    value('capStyle', S.capStyle, S.style[prefs.captionStyle], (d) => ({ captionStyle: step(CaptionStyle.options, prefs.captionStyle, d) })),
    { id: 'reset', name: S.reset, value: '', label: S.reset, hint: strings.a11y.resetIntroHint, press: onResetFirstRun },
    { id: 'about', name: S.about, value: '', label: strings.a11y.about, press: onAbout },
  ]
}

/**
 * Vertical list. On a value row ◄► change the value (Select steps forward too) and the new value is announced; the
 * rail is reached with ◄ from an action row (Hear it, the introduction, About). Every change is saved by Root
 * (PUT /me/prefs). Focus memory brings you back to the row you left, e.g. after About or the introduction.
 */
export function Settings(props: SettingsProps) {
  const { onChange } = props
  const rows = settingsRows(props)
  const { remember, lastId } = useFocusMemory('settings', useCallback(() => {}, []))
  const initial = pickInitialFocus(lastId.current, rows.map((r) => r.id), 'adDefault')
  const focused = useRef<string | null>(null)
  // Steps start from the latest prefs, including changes not yet rendered (two quick presses must step twice).
  const latest = useRef(props.prefs)
  latest.current = props.prefs
  const change = (r: SettingRow, dir: 1 | -1) => {
    const p = settingsRows({ ...props, prefs: latest.current }).find((x) => x.id === r.id)!.step!(dir)
    latest.current = { ...latest.current, ...p }
    onChange(p)
    const after = settingsRows({ ...props, prefs: latest.current }).find((x) => x.id === r.id)!
    AccessibilityInfo.announceForAccessibility(strings.a11y.setting(after.name, after.value))
  }
  useKeyHandler((key, repeat) => {
    if (key !== 'left' && key !== 'right') return false
    const r = rows.find((x) => x.id === focused.current)
    if (!r?.step) return false
    if (!repeat) change(r, key === 'right' ? 1 : -1) // a held key changes the value once
    return true
  })
  return (
    <View style={{ gap: px(14), maxWidth: px(1100) }}>
      <T variant="title" style={{ marginBottom: px(16) }}>{S.heading}</T>
      {rows.map((r) => (
        <Focusable key={r.id} testID={`settings:${r.id}`} label={r.label} hint={r.hint} role={r.step ? 'adjustable' : 'button'} value={r.step ? r.value : undefined} defaultFocus={r.id === initial}
          onFocus={() => { focused.current = r.id; remember(r.id) }} onBlur={() => { if (focused.current === r.id) focused.current = null }}
          onPress={r.step ? () => change(r, 1) : r.press}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: px(20), paddingHorizontal: px(24), backgroundColor: tokens.color.surface1 }}
          focusedStyle={{ backgroundColor: tokens.color.surface2 }}>
          <T variant="body">{r.name}</T>
          {r.value ? <T variant="body" color={tokens.color.interactive}>{r.step ? `‹  ${r.value}  ›` : r.value}</T> : null}
        </Focusable>
      ))}
    </View>
  )
}
