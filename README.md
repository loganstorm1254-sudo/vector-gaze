# Vector Eye Color

A site for a real [Anki Vector](https://www.digitaldreamlabs.com/) that pairs the same way the companion app does, then lets you paint his eyes from an RGB wheel.

It is a static Next.js app. Deploy it on Vercel. Pairing and eye-color commands run in the browser — Vercel never talks to your robot.

## What you do

1. Open the site in **Chrome or Edge** (desktop or Android). Safari on iPhone cannot use Web Bluetooth.
2. Put Vector on his charger.
3. Double-click the backpack button — the raised key on his LED strip. He shows a key icon and a 6-digit PIN.
4. Click **Find Vector** and pick the BLE device whose name matches that PIN (or `Vector XXXX`).
5. Type the PIN. If it checks out, the RGB wheel unlocks.
6. Stay on the **same Wi-Fi** as Vector. After pairing, eye color is sent over the BLE SDK proxy (`/v1/set_eye_color`).

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

## If eye color does nothing after a good PIN

The backpack PIN only opens the BLE tunnel. Eye color rides Vector’s **SDK proxy**, which requires the client `guid` from:

```ini
# ~/.anki_vector/sdk_config.ini
guid = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Paste that into the **SDK guid** field on the paired screen, then hit **Apply color**.

WirePod: use the client token from your WirePod / SDK configure step.

Factory RTS v2/v3 robots have no BLE SDK proxy. Update Vector first.

## Stack

- Next.js + Tailwind + shadcn/ui
- Web Bluetooth + Vector RTS (vendored from [vector-web-setup](https://github.com/digital-dream-labs/vector-web-setup), MIT)

## License

The app code in this repo is yours to use. The vendored RTS files keep Digital Dream Labs’ MIT license — see `src/vendor/vector-rts/LICENSE`.
