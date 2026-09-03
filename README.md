# Vector Eyes, Volume & Overlays

Pair an unlocked / CFW [Anki Vector](https://www.digitaldreamlabs.com/) over Bluetooth, then paint his eyes, set speaker volume, and load Face overlays.

**Deploy on Vercel.** No Wire-Pod. No Anki cloud. No Escape Pod.

After the backpack PIN, the page reads Vector’s Wi-Fi IP over BLE and talks to his onboard eng console on your LAN:

- Eyes — `ProcFace_Hue` / `ProcFace_Saturation` on `:8889`
- Volume — `MasterVolumeLevel` + `DebugSetMasterVolume` on `:8888`
- Overlays — `ProcFace_CustomEyes` + `ProcFace_FlavorOfGay` + `LOOK_LoadFaceOverlay` on `:8889` (same Face menu as `/consolevars`)

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
5. Drag the RGB wheel, tap a volume level, or pick an eye overlay. Stay on the **same Wi-Fi** as Vector.

## How it works

1. **BLE** — PIN unlocks RTS and reads his IP.
2. **LAN from the browser** — with Chrome Local Network Access granted:
   - Eyes: `http://<vector-ip>:8889/consolefunccall?func=ProcFace_Hue&args=…` (+ Saturation)
   - Volume: set `MasterVolumeLevel` / `kMasterVolumeLevel` (0–5), then `DebugSetMasterVolume` on `:8888`
   - Overlays: set `kProcFace_CustomEyes` + `kProcFace_FlavorOfGay` (0–8), then `LOOK_LoadFaceOverlay` on `:8889`
3. Unlocked CFW console hooks only. No SDK guid. No cloud mint.

### Custom overlay image

Built-in flavors (Lesbian → Galaxy) are already on the robot. Pick **Custom**, choose any image — the site resizes it to 184×96, wipes the previous custom overlay, writes the new JPG to Vector over your LAN, and runs `LOOK_LoadFaceOverlay`. No SSH password. No SCP.

- **Local `npm run dev`** (same Wi-Fi): uses the public unlocked-Vector root key over SSH to write `/data/data/customFaceOverlay.jpg`.
- **Vercel / remote host**: the browser PUTs the image into the eng-console `/resources` face-overlay slot and loads it (Chrome Local Network Access required).
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
