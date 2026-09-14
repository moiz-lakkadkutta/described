import React from 'react'
import { Root } from '@described/shared-ui'
// Fire OS entry. Platform-specific wiring (fonts, IAP, camera) goes here, never in shared-ui.
export default function App() { return <Root apiBaseUrl={process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000'} scale={0.5} /> }
