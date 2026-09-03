import { NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

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

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(cmd, args, { env: { ...process.env, ...env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
      child.on("error", (err) => {
        resolve({ code: 1, stdout, stderr: String(err) });
      });
    },
  );
}

/** Optional local-dev SCP when VECTOR_SSH_PASSWORD is set. */
async function uploadOverlayJpeg(ip: string, jpegBase64: string) {
  const password = process.env.VECTOR_SSH_PASSWORD?.trim();
  if (!password) {
    return {
      ok: false,
      tried: 0,
      error:
        "No VECTOR_SSH_PASSWORD in the local env. Browser PUT is attempted separately; or SCP customFaceOverlay.jpg to /data/data/ on the robot.",
    };
  }

  const user = process.env.VECTOR_SSH_USER?.trim() || "root";
  const tmp = join(tmpdir(), `customFaceOverlay-${Date.now()}.jpg`);
  try {
    await writeFile(tmp, Buffer.from(jpegBase64, "base64"));
    const scp = await run(
      "sshpass",
      [
        "-p",
        password,
        "scp",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        tmp,
        `${user}@${ip}:/data/data/customFaceOverlay.jpg`,
      ],
    );
    if (scp.code === 0) {
      return { ok: true, tried: 1, via: "scp" as const };
    }
    return {
      ok: false,
      tried: 1,
      error: scp.stderr || scp.stdout || `scp exited ${scp.code}`,
    };
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
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
    const result = await uploadOverlayJpeg(ip, jpegBase64);
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
