import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORTS = [8889, 8888] as const;

function isPrivateIp(ip: string) {
  // Basic LAN / link-local guard so this route can't be used as an open proxy.
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

export async function POST(request: Request) {
  let body: { ip?: string; hue?: number; saturation?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const ip = String(body.ip ?? "").trim();
  const hue = Number(body.hue);
  const saturation = Number(body.saturation);

  if (!ip || !isPrivateIp(ip)) {
    return NextResponse.json(
      { ok: false, error: "Expected a private LAN IP for Vector." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(hue) || !Number.isFinite(saturation)) {
    return NextResponse.json(
      { ok: false, error: "hue and saturation are required." },
      { status: 400 },
    );
  }

  const h = Number(hue.toFixed(4));
  const s = Number(saturation.toFixed(4));
  const attempts: string[] = [];
  let ok = false;

  for (const port of PORTS) {
    const base = `http://${ip}:${port}`;
    const urls = [
      `${base}/consolefunccall?func=ProcFace_Hue&args=${encodeURIComponent(String(h))}`,
      `${base}/consolefunccall?func=ProcFace_Saturation&args=${encodeURIComponent(String(s))}`,
      `${base}/consolevarset?key=kProcFace_Hue&value=${encodeURIComponent(String(h))}`,
      `${base}/consolevarset?key=kProcFace_Saturation&value=${encodeURIComponent(String(s))}`,
    ];

    for (const url of urls) {
      attempts.push(url);
      if (await hit(url)) ok = true;
    }

    if (
      await hit(`${base}/consolefunccall`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `func=ProcFace_Hue&args=${encodeURIComponent(String(h))}`,
      })
    ) {
      ok = true;
    }
    if (
      await hit(`${base}/consolefunccall`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `func=ProcFace_Saturation&args=${encodeURIComponent(String(s))}`,
      })
    ) {
      ok = true;
    }
  }

  return NextResponse.json({
    ok,
    ip,
    hue: h,
    saturation: s,
    tried: attempts.length,
  });
}
