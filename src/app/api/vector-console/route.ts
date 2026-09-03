import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORTS = [8889, 8888] as const;
const ENGINE_PORTS = [8888, 8889] as const;
const ANIM_PORTS = [8889, 8888] as const;

function isPrivateIp(ip: string) {
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(ip) ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(ip)
  );
}

async function hit(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res.ok || (res.status > 0 && res.status < 500);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function setEyes(ip: string, hue: number, saturation: number) {
  const h = Number(hue.toFixed(4));
  const s = Number(saturation.toFixed(4));
  let ok = false;
  let tried = 0;

  for (const port of PORTS) {
    const base = `http://${ip}:${port}`;
    const urls = [
      `${base}/consolefunccall?func=ProcFace_Hue&args=${encodeURIComponent(String(h))}`,
      `${base}/consolefunccall?func=ProcFace_Saturation&args=${encodeURIComponent(String(s))}`,
      `${base}/consolevarset?key=kProcFace_Hue&value=${encodeURIComponent(String(h))}`,
      `${base}/consolevarset?key=kProcFace_Saturation&value=${encodeURIComponent(String(s))}`,
    ];
    for (const url of urls) {
      tried += 1;
      if (await hit(url)) ok = true;
    }
  }

  return { ok, tried, hue: h, saturation: s };
}

async function setVolume(ip: string, volume: number) {
  let ok = false;
  let tried = 0;
  const keys = ["MasterVolumeLevel", "kMasterVolumeLevel"];

  for (const port of ENGINE_PORTS) {
    const base = `http://${ip}:${port}`;
    for (const key of keys) {
      const urls = [
        `${base}/consolevarset?key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(volume))}`,
        `${base}/consolefunccall?func=DebugSetMasterVolume&args=`,
      ];
      for (const url of urls) {
        tried += 1;
        if (await hit(url)) ok = true;
      }
      if (
        await hit(`${base}/consolevarset`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(volume))}`,
        })
      ) {
        ok = true;
      }
      tried += 1;
      if (
        await hit(`${base}/consolefunccall`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "func=DebugSetMasterVolume&args=",
        })
      ) {
        ok = true;
      }
      tried += 1;
    }
  }

  return { ok, tried, volume };
}

async function setOverlay(ip: string, flavor: number | null, opacity: number) {
  let ok = false;
  let tried = 0;
  const enabled = flavor !== null;
  const opacityClamped = Math.min(1, Math.max(0, opacity));

  for (const port of ANIM_PORTS) {
    const base = `http://${ip}:${port}`;
    const pairs: Array<[string, string]> = [
      ["kProcFace_CustomEyes", enabled ? "true" : "false"],
      ["ProcFace_CustomEyes", enabled ? "true" : "false"],
      ["kProcFace_CustomEyeOpacity", String(opacityClamped)],
      ["ProcFace_CustomEyeOpacity", String(opacityClamped)],
    ];

    if (enabled && flavor !== null) {
      pairs.push(["kProcFace_FlavorOfGay", String(flavor)]);
      pairs.push(["ProcFace_FlavorOfGay", String(flavor)]);
    }

    for (const [key, value] of pairs) {
      tried += 1;
      if (
        await hit(
          `${base}/consolevarset?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`,
        )
      ) {
        ok = true;
      }
      tried += 1;
      if (
        await hit(`${base}/consolevarset`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`,
        })
      ) {
        ok = true;
      }
    }

    if (enabled) {
      tried += 1;
      if (
        await hit(`${base}/consolefunccall?func=LOOK_LoadFaceOverlay&args=`)
      ) {
        ok = true;
      }
      tried += 1;
      if (
        await hit(`${base}/consolefunccall`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "func=LOOK_LoadFaceOverlay&args=",
        })
      ) {
        ok = true;
      }
    }
  }

  return { ok, tried, flavor, opacity: opacityClamped };
}

/**
 * Write /data/data/customFaceOverlay.jpg using the public unlocked-Vector root key.
 * No user password / SCP — works whenever this Next process can reach the robot LAN.
 */
async function uploadOverlayJpeg(
  ip: string,
  jpegBase64: string,
  bridgeBase64?: string,
) {
  const bytes = Buffer.from(jpegBase64, "base64");
  if (bytes.byteLength < 32) {
    return { ok: false, tried: 0, error: "JPEG payload too small" };
  }

  const bridge =
    typeof bridgeBase64 === "string" && bridgeBase64.length > 16
      ? Buffer.from(bridgeBase64, "base64")
      : undefined;

  // Dynamic import keeps ssh2 out of the Turbopack graph at build time.
  const { uploadOverlayViaUnlockSsh } = await import("@/lib/vector/ssh-upload");
  const ssh = await uploadOverlayViaUnlockSsh(ip, bytes, bridge);
  if (ssh.ok) {
    return { ok: true, tried: 1, via: "unlock-ssh" as const, path: ssh.path };
  }

  // Fallback: HTTP PUT into eng-console rewrite paths (same LAN).
  // Caller must not treat this as flavor-8 Custom — only as staging.
  let putOk = false;
  let tried = 0;
  const paths = [
    "/resources/assets/faceOverlays/galaxy.jpg",
    "/persistent/customFaceOverlay.jpg",
    "/cache/customFaceOverlay.jpg",
  ];
  for (const port of ANIM_PORTS) {
    for (const path of paths) {
      const url = `http://${ip}:${port}${path}`;
      tried += 1;
      await hit(url, { method: "DELETE" });
      tried += 1;
      if (
        await hit(url, {
          method: "PUT",
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": String(bytes.length),
          },
          body: bytes,
        })
      ) {
        putOk = true;
      }
    }
  }
  if (putOk) {
    return { ok: true, tried, via: "http-put" as const };
  }
  return {
    ok: false,
    tried,
    error: ssh.error || "Unlock-key SSH and HTTP PUT both failed.",
  };
}

export async function POST(request: Request) {
  let body: {
    ip?: string;
    action?: string;
    hue?: number;
    saturation?: number;
    volume?: number;
    flavor?: number | null;
    opacity?: number;
    jpegBase64?: string;
    bridgeBase64?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const ip = String(body.ip ?? "").trim();
  if (!ip || !isPrivateIp(ip)) {
    return NextResponse.json(
      { ok: false, error: "Expected a private LAN IP for Vector." },
      { status: 400 },
    );
  }

  const action = body.action ?? "eyes";

  if (action === "volume") {
    const volume = Number(body.volume);
    if (!Number.isInteger(volume) || volume < 0 || volume > 5) {
      return NextResponse.json(
        { ok: false, error: "volume must be an integer 0–5." },
        { status: 400 },
      );
    }
    const result = await setVolume(ip, volume);
    return NextResponse.json({ ip, action, ...result });
  }

  if (action === "overlay") {
    const flavor =
      body.flavor === null || body.flavor === undefined
        ? null
        : Number(body.flavor);
    if (
      flavor !== null &&
      (!Number.isInteger(flavor) || flavor < 0 || flavor > 8)
    ) {
      return NextResponse.json(
        { ok: false, error: "flavor must be null or an integer 0–8." },
        { status: 400 },
      );
    }
    const opacity = Number(body.opacity ?? 0.8);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      return NextResponse.json(
        { ok: false, error: "opacity must be 0–1." },
        { status: 400 },
      );
    }
    const result = await setOverlay(ip, flavor, opacity);
    return NextResponse.json({ ip, action, ...result });
  }

  if (action === "overlay-upload") {
    const jpegBase64 = String(body.jpegBase64 ?? "");
    if (!jpegBase64 || jpegBase64.length > 2_000_000) {
      return NextResponse.json(
        { ok: false, error: "jpegBase64 missing or too large." },
        { status: 400 },
      );
    }
    const result = await uploadOverlayJpeg(
      ip,
      jpegBase64,
      typeof body.bridgeBase64 === "string" ? body.bridgeBase64 : undefined,
    );
    return NextResponse.json({ ip, action, ...result });
  }

  const hue = Number(body.hue);
  const saturation = Number(body.saturation);
  if (!Number.isFinite(hue) || !Number.isFinite(saturation)) {
    return NextResponse.json(
      { ok: false, error: "hue and saturation are required." },
      { status: 400 },
    );
  }

  const result = await setEyes(ip, hue, saturation);
  return NextResponse.json({ ip, action: "eyes", ...result });
}
