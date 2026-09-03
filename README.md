# Vector Eye Color

A site for a real [Anki Vector](https://www.digitaldreamlabs.com/) that pairs over Bluetooth, then lets you paint his eyes from an RGB wheel.

Built for **unlocked / CFW** Vectors that have **no Wire-Pod and no cloud**. After the backpack PIN, color is sent to Vector’s onboard eng console on your LAN (`:8889` / `:8888`). Nothing phones home.

## What you do

1. Open the site in **Chrome or Edge** (desktop or Android). Safari on iPhone cannot use Web Bluetooth.
2. Put Vector on his charger.
3. Double-click the backpack button — he shows a key icon and a 6-digit PIN.
4. Click **Find Vector** and pick him.
5. Type the PIN.
6. Drag the RGB wheel. Stay on the **same Wi-Fi** as Vector.

No accounts. No guid paste. No Escape Pod / Wire-Pod.

## How it works

1. **BLE** — backpack PIN unlocks an encrypted RTS session and reads Vector’s Wi-Fi IP.
2. **LAN** — the page calls his local console:
   - `http://<vector-ip>:8889/consolefunccall?func=ProcFace_Hue&args=…`
   - `http://<vector-ip>:8889/consolefunccall?func=ProcFace_Saturation&args=…`
3. Those are the same `ProcFace_Hue` / `ProcFace_Saturation` hooks unlocked CFW exposes in consolevars. No SDK token required.

Best when you run the app on **localhost** (or another HTTP origin on your LAN). A public HTTPS host (Vercel) may be blocked by the browser from talking to a private `http://192.168…` address — use local `npm run dev` if that happens.

## Deploy on Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New Project** → import the repo.
3. Framework preset: Next.js. No env vars.
4. Deploy. Use the `https://` URL for BLE pairing.

If eye color can’t reach the robot from Vercel (browser private-network / mixed-content rules), run locally instead:

```bash
npm install
npm run dev
```

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147). Localhost is a secure context for BLE and can call Vector’s HTTP console on the LAN.

`/?demo=1` opens the wheel without a robot.

## Stack

- Next.js + Tailwind + shadcn/ui
- Web Bluetooth + Vector RTS (vendored from [vector-web-setup](https://github.com/digital-dream-labs/vector-web-setup), MIT)
- Unlocked CFW eng console (`consolefunccall` / `consolevarset`)

## License

The app code in this repo is yours to use. The vendored RTS files keep Digital Dream Labs’ MIT license — see `src/vendor/vector-rts/LICENSE`.
