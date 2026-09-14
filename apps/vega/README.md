# Described — Vega OS

This directory is created **on a Mac/Linux machine with the Vega SDK** using the Vega CLI (React Native for Vega 0.72):

```
cd apps && vega project create vega --template hello-world   # exact command per Amazon's Vega docs for SDK 0.24
cd vega && pnpm add @described/shared-ui@workspace:* @moizp/vega-media-kit
# follow AmazonAppDev/vega-video-sample's post-install to vendor Shaka
# replace App.tsx with ./App.template.tsx
vega virtual-device start && npm run build:app && vega run-app build/aarch64-release/described_aarch64.vpkg
```

Only this entry file is Vega-specific. All screens live in `packages/shared-ui`.
