// The Fire TV / Android TV launcher artwork. Expo writes android:icon (app.json icon / adaptiveIcon) but has no key for
// android:banner, the 16:9 image a TV launcher shows for the app on its apps row.
// https://developer.android.com/training/tv/get-started/create "Home screen banner": android:banner on <application>
//   supplies the default banner for all activities; an xhdpi resource of 320 x 180 px, text included in the image.
// https://developer.android.com/design/ui/tv/guides/system/tv-app-icon-guidelines (banner: 16:9, 320 x 180 xhdpi)
// https://developer.amazon.com/docs/fire-tv/live-tv-resources.html Fire TV reads the application banner through the
//   package manager (getApplicationBanner). A sideloaded APK has no Appstore listing, so its own icon and banner are all
//   the launcher has (Amazon staff, https://forums.developer.amazon.com/questions/483/).
// This plugin copies assets/images/described-banner-320x180.png to res/drawable-xhdpi/tv_banner.png and points
// <application android:banner> at it.
const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')

const SOURCE = 'assets/images/described-banner-320x180.png'
const DRAWABLE = 'tv_banner'
const RES_DIR = 'app/src/main/res/drawable-xhdpi'

/** Pure transform of the parsed manifest (xml2js shape), exported for tests. Sets the banner on <application>. */
function patch(manifest) {
  manifest.manifest.application[0].$['android:banner'] = `@drawable/${DRAWABLE}`
  return manifest
}

function withTvBanner(config) {
  config = withDangerousMod(config, ['android', async (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, RES_DIR)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(c.modRequest.projectRoot, SOURCE), path.join(dir, `${DRAWABLE}.png`))
    return c
  }])
  return withAndroidManifest(config, (c) => {
    c.modResults = patch(c.modResults)
    return c
  })
}
module.exports = withTvBanner
module.exports.patch = patch
module.exports.SOURCE = SOURCE
module.exports.DRAWABLE = DRAWABLE
module.exports.RES_DIR = RES_DIR
