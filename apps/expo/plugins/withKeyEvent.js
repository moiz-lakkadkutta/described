// Forwards remote keys to JS through react-native-keyevent, which react-tv-space-navigation listens to.
// Adapted from AmazonAppDev/react-native-multi-tv-app-sample (MIT-0) apps/expo-multi-tv/plugins/withKeyEvent.js:
// - getInstance()?. so a key pressed before the module exists cannot crash the activity;
// - only D-pad keys are consumed (native focus must not move too); Back and media keys keep Android's default.
const { withMainActivity } = require('expo/config-plugins')

const TAG = '// described:keyevent'
const IMPORTS = ['import android.view.KeyEvent', 'import com.github.kevinejohn.keyevent.KeyEventModule']
const BODY = `
  ${TAG}
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    when (event.action) {
      KeyEvent.ACTION_DOWN -> KeyEventModule.getInstance()?.onKeyDownEvent(event.keyCode, event)
      KeyEvent.ACTION_UP -> KeyEventModule.getInstance()?.onKeyUpEvent(event.keyCode, event)
    }
    return super.dispatchKeyEvent(event)
  }
  private fun isDpad(keyCode: Int) = keyCode in KeyEvent.KEYCODE_DPAD_UP..KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER
  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean = isDpad(keyCode) || super.onKeyDown(keyCode, event)
  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean = isDpad(keyCode) || super.onKeyUp(keyCode, event)
`

module.exports = function withKeyEvent(config) {
  return withMainActivity(config, (c) => {
    let src = c.modResults.contents
    if (c.modResults.language !== 'kt') throw new Error('withKeyEvent expects a Kotlin MainActivity')
    if (src.includes(TAG)) return c
    for (const imp of IMPORTS) if (!src.includes(imp)) src = src.replace(/^(package .*\n)/m, `$1${imp}\n`)
    src = src.replace(/(class MainActivity\s*:\s*ReactActivity\(\)\s*\{)/, `$1\n${BODY}`)
    if (!src.includes(TAG)) throw new Error('withKeyEvent: MainActivity class declaration not found')
    c.modResults.contents = src
    return c
  })
}
