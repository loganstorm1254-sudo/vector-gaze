import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORTS = [8889, 8888] as const;
const ENGINE_PORTS = [8888, 8889] as const;

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

export async function POST(request: Request) {
  let body: {
    ip?: string;
    action?: string;
    hue?: number;
    saturation?: number;
    volume?: number;
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

  const action = body.action === "volume" ? "volume" : "eyes";

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

  const hue = Number(body.hue);
  const saturation = Number(body.saturation);
  if (!Number.isFinite(hue) || !Number.isFinite(saturation)) {
    return NextResponse.json(
      { ok: false, error: "hue and saturation are required." },
      { status: 400 },
    );
  }

  const result = await setEyes(ip, hue, saturation);
  return NextResponse.json({ ip, action, ...result });
}
