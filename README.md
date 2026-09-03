# Vector Eye Color

A site for a real [Anki Vector](https://www.digitaldreamlabs.com/) that pairs over Bluetooth, then lets you paint his eyes from an RGB wheel.

It is a static Next.js app. Deploy it on Vercel. Pairing and eye-color commands run in the browser — Vercel never talks to your robot.

## What you do

1. Open the site in **Chrome or Edge** (desktop or Android). Safari on iPhone cannot use Web Bluetooth.
2. Put Vector on his charger.
3. Double-click the backpack button — the raised key on his LED strip. He shows a key icon and a 6-digit PIN.
4. Click **Find Vector** and pick the BLE device whose name matches that PIN (or `Vector XXXX`).
5. Type the PIN. The site authorizes the SDK tunnel automatically (Escape Pod / Wire-Pod style). No guid to paste.
6. Drag the RGB wheel. Stay on the **same Wi-Fi** as Vector.

## Deploy on Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New Project** → import the repo.
3. Framework preset: Next.js. No env vars.
4. Deploy. Use the `https://` URL — Web Bluetooth only works on HTTPS (or localhost).

Or from the CLI:

```bash
npm i -g vercel
vercel
```

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147). Localhost counts as a secure context, so BLE works there too.

`/?demo=1` opens the wheel without a robot, so you can check the UI.

## How eye color auth works

After the backpack PIN succeeds, the site runs Escape Pod / Wire-Pod cloud auth over BLE (same fixed session token Wire-Pod uses) and stores the minted client token locally. You do **not** paste a guid.

Eye color is written with:

```json
{"update_settings": true, "settings": {"custom_eye_color": {"enabled": true, "hue": 0.42, "saturation": 1.0}}}
```

That matches Wire-Pod’s SDK app. Stock Anki-cloud-only robots without EP/Wire-Pod firmware can’t mint that token from PIN alone.

## Stack

- Next.js + Tailwind + shadcn/ui
- Web Bluetooth + Vector RTS (vendored from [vector-web-setup](https://github.com/digital-dream-labs/vector-web-setup), MIT)

## License

The app code in this repo is yours to use. The vendored RTS files keep Digital Dream Labs’ MIT license — see `src/vendor/vector-rts/LICENSE`.
