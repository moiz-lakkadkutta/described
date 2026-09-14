import React from 'react'
import { View } from 'react-native'
import type { Prefs } from '@described/contracts'
import { Focusable, T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

const VOICES: Prefs['voice'][] = ['Joanna', 'Matthew', 'Vicki', 'Daniel']
const SCALES: Prefs['captionScale'][] = [100, 125, 150, 200]
const cycle = <T,>(arr: readonly T[], cur: T) => arr[(arr.indexOf(cur) + 1) % arr.length]!

/** Vertical list; values change with Select (cycles) — ◄► handling arrives via Root's remote hook. Every change is announced. */
export function Settings({ prefs, onChange, onHearVoice }: { prefs: Prefs; onChange: (p: Partial<Prefs>) => void; onHearVoice: (v: Prefs['voice']) => void }) {
  const row = (label: string, value: string, onPress: () => void, first = false, extra?: React.ReactNode) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: px(24) }}>
      <Focusable label={`${label}: ${value}`} hint="Press to change" hasTVPreferredFocus={first} onPress={onPress} style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: px(20), paddingHorizontal: px(24), backgroundColor: tokens.color.surface1 }}>
        <T variant="body">{label}</T><T variant="body" color={tokens.color.interactive}>{value}</T>
      </Focusable>
      {extra}
    </View>
  )
  return (
    <View style={{ gap: px(14), maxWidth: px(1100) }}>
      <T variant="title" style={{ marginBottom: px(16) }}>{strings.rail.settings}</T>
      {row(strings.settings.adDefault, prefs.adDefault ? 'On' : 'Off', () => onChange({ adDefault: !prefs.adDefault }), true)}
      {row(strings.settings.voice, prefs.voice, () => onChange({ voice: cycle(VOICES, prefs.voice) }), false,
        <Focusable label={`${strings.settings.hearIt}: ${prefs.voice}`} onPress={() => onHearVoice(prefs.voice)} style={{ paddingVertical: px(20), paddingHorizontal: px(24), backgroundColor: tokens.color.surface2 }}><T variant="body">{strings.settings.hearIt}</T></Focusable>)}
      {row(strings.settings.extended, prefs.extendedMode ? 'On' : 'Off', () => onChange({ extendedMode: !prefs.extendedMode }))}
      {row(strings.settings.capSize, `${prefs.captionScale}%`, () => onChange({ captionScale: cycle(SCALES, prefs.captionScale) }))}
      {row(strings.settings.reset, '', () => onChange({ firstRunDone: false }))}
    </View>
  )
}
