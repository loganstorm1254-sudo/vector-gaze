# Vector Eye Color

A site for a real [Anki Vector](https://www.digitaldreamlabs.com/) that pairs over Bluetooth, then lets you paint his eyes from an RGB wheel.

It is a static Next.js app. Deploy it on Vercel. Pairing and eye-color commands run in the browser — Vercel never talks to your robot.

## What you do

1. Open the site in **Chrome or Edge** (desktop or Android). Safari on iPhone cannot use Web Bluetooth.
2. Put Vector on his charger.
3. Double-click the backpack button — the raised key on his LED strip. He shows a key icon and a 6-digit PIN.
4. Click **Find Vector** and pick the BLE device whose name matches that PIN (or `Vector XXXX`).
5. Type the PIN. That unlocks encrypted BLE — it does **not** require Wire-Pod.
6. Drag the RGB wheel. Stay on the **same Wi-Fi** as Vector.

### SDK token (unlocked CFW / no Wire-Pod)

Eye color rides Vector’s SDK proxy. That needs a **client guid**, and the backpack PIN cannot mint one by itself.

Anki’s account cloud is gone. Options:

1. **Paste an existing guid** from `~/.anki_vector/sdk_config.ini` (`guid=` line) — best path if you don’t run Wire-Pod.
2. **Escape Pod cloud** (optional) — only if official Escape Pod or Wire-Pod is running on your LAN and Vector can resolve `escapepod.local`. Status `ConnectionError (1)` means he couldn’t reach that host.

Unlocked / custom firmware does **not** bypass SDK auth.

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

## How eye color is written

```json
{"update_settings": true, "settings": {"custom_eye_color": {"enabled": true, "hue": 0.42, "saturation": 1.0}}}
```

Plus a live `/v1/set_eye_color` nudge when the permanent write succeeds.

## Stack

- Next.js + Tailwind + shadcn/ui
- Web Bluetooth + Vector RTS (vendored from [vector-web-setup](https://github.com/digital-dream-labs/vector-web-setup), MIT)

## License

The app code in this repo is yours to use. The vendored RTS files keep Digital Dream Labs’ MIT license — see `src/vendor/vector-rts/LICENSE`.
