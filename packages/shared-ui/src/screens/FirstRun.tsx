import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Focusable, T } from '../components'
import { strings } from '../strings'
import { tokens } from '../theme/tokens'
import { px } from '../theme/scale'

/** Three panels, one focusable each, spoken by the app voice as each appears. No typing anywhere. */
export function FirstRun({ onDone, speakText }: { onDone: (extendedMode: boolean) => void; speakText: (t: string) => void }) {
  const [i, setI] = useState(0)
  const p = strings.firstRun[i]!
  useEffect(() => { speakText(`${p.title} ${p.body}`) }, [i, p, speakText])
  const last = i === strings.firstRun.length - 1
  return (
    <View style={{ flex: 1, justifyContent: 'center', maxWidth: px(1200), gap: px(28) }}>
      <T variant="display">{p.title}</T>
      <T variant="heading" color={tokens.color.textSecondary}>{p.body}</T>
      <View style={{ flexDirection: 'row', gap: px(16), marginTop: px(24) }}>
        <Focusable label={p.cta} hasTVPreferredFocus onPress={() => (last ? onDone(true) : setI(i + 1))} style={{ backgroundColor: tokens.color.interactive, paddingHorizontal: px(40), paddingVertical: px(20) }}><T variant="heading" color={tokens.color.ground}>{p.cta}</T></Focusable>
        {p.alt ? <Focusable label={p.alt} onPress={() => onDone(false)} style={{ backgroundColor: tokens.color.surface2, paddingHorizontal: px(40), paddingVertical: px(20) }}><T variant="heading">{p.alt}</T></Focusable> : null}
      </View>
    </View>
  )
}
