# Vector Eye Color

Pair an unlocked / CFW [Anki Vector](https://www.digitaldreamlabs.com/) over Bluetooth, then paint his eyes from an RGB wheel.

**Deploy on Vercel.** No Wire-Pod. No Anki cloud. No Escape Pod.

After the backpack PIN, the page reads Vector’s Wi-Fi IP over BLE and sets `ProcFace_Hue` / `ProcFace_Saturation` on his onboard eng console (`:8889`). Color stays on your LAN.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Vercel → **Add New Project** → import the repo.
3. Framework: Next.js. No env vars.
4. Deploy and open the `https://` URL.

Use **Chrome or Edge** (desktop or Android). Safari on iPhone cannot do Web Bluetooth.

When Chrome asks **“Allow this site to access your local network?”** — click **Allow**. That permission is what lets a Vercel HTTPS page reach `http://192.168.x.x:8889` on your robot.

## What you do

1. Put Vector on his charger.
2. Double-click the backpack — key icon + 6-digit PIN.
3. **Find Vector** → enter the PIN.
4. Click **Allow** on the local-network prompt if Chrome shows it.
5. Drag the RGB wheel. Stay on the **same Wi-Fi** as Vector.

## How it works

1. **BLE** — PIN unlocks RTS and reads his IP.
2. **LAN from the browser** — with Chrome Local Network Access granted:
   - `http://<vector-ip>:8889/consolefunccall?func=ProcFace_Hue&args=…`
   - `http://<vector-ip>:8889/consolefunccall?func=ProcFace_Saturation&args=…`
3. Those are the unlocked CFW face hooks. No SDK guid. No cloud mint.

## Run locally (optional)

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

`/?demo=1` opens the wheel without a robot.

## Stack

- Next.js + Tailwind + shadcn/ui
- Web Bluetooth + Vector RTS (vendored from [vector-web-setup](https://github.com/digital-dream-labs/vector-web-setup), MIT)
- Unlocked CFW eng console + Chrome Local Network Access for Vercel

## License

The app code in this repo is yours to use. The vendored RTS files keep Digital Dream Labs’ MIT license — see `src/vendor/vector-rts/LICENSE`.
