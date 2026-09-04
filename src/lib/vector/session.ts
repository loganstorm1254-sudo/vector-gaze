import { RtsCliUtil } from "@/vendor/vector-rts/rtsCliUtil.js";
import { IntBuffer } from "@/vendor/vector-rts/clad.js";
import { Sessions } from "@/vendor/vector-rts/sessions.js";
import { VectorBluetooth } from "@/vendor/vector-rts/vectorBluetooth.js";
import { RtsV2Handler } from "@/vendor/vector-rts/rtsV2Handler.js";
import { RtsV3Handler } from "@/vendor/vector-rts/rtsV3Handler.js";
import { RtsV4Handler } from "@/vendor/vector-rts/rtsV4Handler.js";
import { RtsV5Handler } from "@/vendor/vector-rts/rtsV5Handler.js";
import { RtsV6Handler } from "@/vendor/vector-rts/rtsV6Handler.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sodium: any = null;

export type PairPhase =
  | "idle"
  | "scanning"
  | "handshaking"
  | "need-pin"
  | "authorizing"
  | "paired"
  | "disconnected";

export type VectorInfo = {
  name: string;
  esn?: string;
  build?: string;
  wifiSsid?: string;
  wifiConnected: boolean;
  ip?: string;
  rtsVersion: number;
  supportsSdkProxy: boolean;
  hasOwner?: boolean;
  isCloudAuthed?: boolean;
};

export type SdkResult = {
  statusCode: number;
  responseType?: string;
  responseBody?: string;
  path: string;
  via: "console";
};

type RtsHandler = {
  enterPin: (pin: string) => void;
  cleanup: () => void;
  doStatus: () => Promise<{ value: StatusValue }>;
  doWifiIp?: () => Promise<{ value: WifiIpValue }>;
  doSdk?: (
    clientGuid: string,
    id: string,
    path: string,
    json: string,
  ) => Promise<{ value: SdkProxyValue }>;
  onReadyForPin: (fn: () => void) => void;
  onEncryptedConnection: (fn: () => void) => void;
  onPrint: (fn: (msg: string) => void) => void;
  waitForResponse?: string;
};

type StatusValue = {
  wifiState?: number;
  wifiSsidHex?: string;
  esn?: string;
  version?: string;
  hasOwner?: boolean;
  isCloudAuthed?: boolean;
};

type WifiIpValue = {
  hasIpV4?: boolean;
  ipV4?: number[];
};

type SdkProxyValue = {
  statusCode?: number;
  responseType?: string;
  responseBody?: string;
};

/** Official permanent presets (RobotSettings EyeColor enum). */
export const EYE_COLOR_ENUM = [
  { name: "Teal", enum: "TIP_OVER_TEAL", value: 0, hue: 0.42, saturation: 1 },
  { name: "Orange", enum: "OVERFIT_ORANGE", value: 1, hue: 0.05, saturation: 0.95 },
  { name: "Yellow", enum: "UNCANNY_YELLOW", value: 2, hue: 0.11, saturation: 1 },
  { name: "Lime", enum: "NON_LINEAR_LIME", value: 3, hue: 0.21, saturation: 1 },
  { name: "Sapphire", enum: "SINGULARITY_SAPPHIRE", value: 4, hue: 0.57, saturation: 1 },
  { name: "Purple", enum: "FALSE_POSITIVE_PURPLE", value: 5, hue: 0.83, saturation: 0.76 },
  { name: "Green", enum: "CONFUSION_MATRIX_GREEN", value: 6, hue: 0.3, saturation: 1 },
] as const;

// Unlocked / CFW eng console ports (anim owns face; engine owns settings).
const CONSOLE_PORTS = [8889, 8888] as const;
const ENGINE_PORTS = [8888, 8889] as const;

/** RobotSettings master_volume enum (settings.proto Volume). */
export const VOLUME_LEVELS = [
  { name: "Mute", value: 0 },
  { name: "Low", value: 1 },
  { name: "Medium low", value: 2 },
  { name: "Medium", value: 3 },
  { name: "Medium high", value: 4 },
  { name: "High", value: 5 },
] as const;

export type VolumeLevel = (typeof VOLUME_LEVELS)[number]["value"];

/** WireOS Face menu — kProcFace_FlavorOfGay indices (Custom = 8). */
export type EyeOverlayRequest = {
  /** null disables ProcFace_CustomEyes */
  flavor: number | null;
  opacity?: number;
};

function generateHandshakeMessage(version: number) {
  return [1].concat(IntBuffer.Int32ToLE(version));
}

function formatIpv4(bytes?: number[]) {
  if (!bytes || bytes.length < 4) return undefined;
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

function hexSsid(hex?: string) {
  if (!hex) return undefined;
  try {
    return RtsCliUtil.convertHexToStr(hex) || undefined;
  } catch {
    return undefined;
  }
}

export function bluetoothSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
}

export function nearestEyeColorEnum(hue: number, saturation: number) {
  let best: (typeof EYE_COLOR_ENUM)[number] = EYE_COLOR_ENUM[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const preset of EYE_COLOR_ENUM) {
    const dh = Math.min(
      Math.abs(preset.hue - hue),
      1 - Math.abs(preset.hue - hue),
    );
    const ds = Math.abs(preset.saturation - saturation);
    const dist = dh * 2 + ds;
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return best;
}

function isLocalDevHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local")
  );
}

/**
 * Ask Chrome for Local Network Access so a Vercel HTTPS page can hit
 * http://192.168.x.x (mixed content is exempted once permission is granted).
 */
export async function ensureLocalNetworkAccess(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;

  const names = ["local-network", "local-network-access"] as const;
  for (const name of names) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = await (navigator.permissions as any).query({ name });
      if (status?.state === "granted") return true;
      if (status?.state === "denied") return false;
    } catch {
      // unsupported name — try the next
    }
  }
  return true; // unknown / prompt will happen on first fetch
}

type LocalFetchInit = RequestInit & {
  targetAddressSpace?: "local" | "loopback" | "public";
};

/**
 * HTTP to Vector's LAN eng console from a Vercel HTTPS page.
 * Uses Chrome Local Network Access (`targetAddressSpace: "local"`).
 */
async function hitRobotHttp(url: string, init?: RequestInit): Promise<"ok" | "opaque" | "fail"> {
  const localInit: LocalFetchInit = {
    ...init,
    cache: "no-store",
    targetAddressSpace: "local",
  };

  try {
    const res = await fetch(url, { ...localInit, mode: "cors" });
    if (res.ok || (res.status > 0 && res.status < 500)) return "ok";
  } catch {
    // fall through
  }

  try {
    await fetch(url, { ...localInit, mode: "no-cors" });
    // Opaque — request likely left the browser, but we cannot read the body.
    return "opaque";
  } catch {
    // fall through
  }

  return "fail";
}

async function probeConsoleReachable(ip: string): Promise<boolean> {
  for (const port of CONSOLE_PORTS) {
    const url = `http://${ip}:${port}/consolevarget?key=kProcFace_Hue`;
    const result = await hitRobotHttp(url);
    if (result === "ok" || result === "opaque") return true;
  }
  return false;
}

async function setEyeColorViaLocalProxy(
  ip: string,
  hue: number,
  saturation: number,
): Promise<boolean> {
  // Only when Next is on the same LAN. Vercel cloud cannot reach 192.168.x.x.
  if (!isLocalDevHost()) return false;
  try {
    const res = await fetch("/api/vector-console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, action: "eyes", hue, saturation }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

async function setEyeColorViaConsole(
  ip: string,
  hue: number,
  saturation: number,
): Promise<boolean> {
  await ensureLocalNetworkAccess();

  if (await setEyeColorViaLocalProxy(ip, hue, saturation)) {
    return true;
  }

  // Prove we can reach the eng console before claiming success.
  if (!(await probeConsoleReachable(ip))) {
    return false;
  }

  const h = Number(hue.toFixed(4));
  const s = Number(saturation.toFixed(4));
  let anyOk = false;

  for (const port of CONSOLE_PORTS) {
    const base = `http://${ip}:${port}`;

    const hueFn = `${base}/consolefunccall?func=ProcFace_Hue&args=${encodeURIComponent(String(h))}`;
    const satFn = `${base}/consolefunccall?func=ProcFace_Saturation&args=${encodeURIComponent(String(s))}`;
    const hueVar = `${base}/consolevarset?key=${encodeURIComponent("kProcFace_Hue")}&value=${encodeURIComponent(String(h))}`;
    const satVar = `${base}/consolevarset?key=${encodeURIComponent("kProcFace_Saturation")}&value=${encodeURIComponent(String(s))}`;

    const results = await Promise.all([
      hitRobotHttp(hueFn),
      hitRobotHttp(satFn),
      hitRobotHttp(hueVar),
      hitRobotHttp(satVar),
      hitRobotHttp(`${base}/consolefunccall`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `func=ProcFace_Hue&args=${encodeURIComponent(String(h))}`,
      }),
      hitRobotHttp(`${base}/consolefunccall`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `func=ProcFace_Saturation&args=${encodeURIComponent(String(s))}`,
      }),
      hitRobotHttp(`${base}/consolevarset`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `key=kProcFace_Hue&value=${encodeURIComponent(String(h))}`,
      }),
      hitRobotHttp(`${base}/consolevarset`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `key=kProcFace_Saturation&value=${encodeURIComponent(String(s))}`,
      }),
    ]);

    if (results.some((r) => r === "ok" || r === "opaque")) anyOk = true;
  }

  return anyOk;
}

async function setVolumeViaLocalProxy(
  ip: string,
  level: VolumeLevel,
): Promise<boolean> {
  if (!isLocalDevHost()) return false;
  try {
    const res = await fetch("/api/vector-console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, action: "volume", volume: level }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/**
 * Same path as demoEngine.html on unlocked CFW:
 * set MasterVolumeLevel, then call DebugSetMasterVolume.
 * Lives on the engine webserver (:8888).
 */
async function setVolumeViaConsole(
  ip: string,
  level: VolumeLevel,
): Promise<boolean> {
  await ensureLocalNetworkAccess();

  if (await setVolumeViaLocalProxy(ip, level)) {
    return true;
  }

  if (!(await probeConsoleReachable(ip))) {
    return false;
  }

  let anyOk = false;
  const keys = ["MasterVolumeLevel", "kMasterVolumeLevel"];

  for (const port of ENGINE_PORTS) {
    const base = `http://${ip}:${port}`;

    for (const key of keys) {
      const setUrl = `${base}/consolevarset?key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(level))}`;
      const applyUrl = `${base}/consolefunccall?func=DebugSetMasterVolume&args=`;

      const results = await Promise.all([
        hitRobotHttp(setUrl),
        hitRobotHttp(applyUrl),
        hitRobotHttp(`${base}/consolevarset`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(level))}`,
        }),
        hitRobotHttp(`${base}/consolefunccall`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "func=DebugSetMasterVolume&args=",
        }),
      ]);

      if (results.some((r) => r === "ok" || r === "opaque")) anyOk = true;
    }
  }

  return anyOk;
}

async function setEyeOverlayViaLocalProxy(
  ip: string,
  flavor: number | null,
  opacity: number,
): Promise<boolean> {
  if (!isLocalDevHost()) return false;
  try {
    const res = await fetch("/api/vector-console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip,
        action: "overlay",
        flavor,
        opacity,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/**
 * WireOS Face menu (:8889/consolevars → Face):
 * kProcFace_CustomEyes + kProcFace_FlavorOfGay + LOOK_LoadFaceOverlay.
 */
async function setEyeOverlayViaConsole(
  ip: string,
  flavor: number | null,
  opacity: number,
): Promise<boolean> {
  await ensureLocalNetworkAccess();

  if (await setEyeOverlayViaLocalProxy(ip, flavor, opacity)) {
    return true;
  }

  if (!(await probeConsoleReachable(ip))) {
    return false;
  }

  const enabled = flavor !== null;
  const opacityClamped = Math.min(1, Math.max(0, opacity));
  let anyOk = false;

  for (const port of CONSOLE_PORTS) {
    const base = `http://${ip}:${port}`;
    const calls: Array<Promise<"ok" | "opaque" | "fail">> = [];

    for (const [key, value] of [
      ["kProcFace_CustomEyes", enabled ? "true" : "false"],
      ["ProcFace_CustomEyes", enabled ? "true" : "false"],
      ["kProcFace_CustomEyeOpacity", String(opacityClamped)],
      ["ProcFace_CustomEyeOpacity", String(opacityClamped)],
    ] as const) {
      calls.push(
        hitRobotHttp(
          `${base}/consolevarset?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`,
        ),
      );
      calls.push(
        hitRobotHttp(`${base}/consolevarset`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`,
        }),
      );
    }

    if (enabled && flavor !== null) {
      for (const key of ["kProcFace_FlavorOfGay", "ProcFace_FlavorOfGay"]) {
        calls.push(
          hitRobotHttp(
            `${base}/consolevarset?key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(flavor))}`,
          ),
        );
        calls.push(
          hitRobotHttp(`${base}/consolevarset`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `key=${encodeURIComponent(key)}&value=${encodeURIComponent(String(flavor))}`,
          }),
        );
      }

      calls.push(
        hitRobotHttp(
          `${base}/consolefunccall?func=LOOK_LoadFaceOverlay&args=`,
        ),
      );
      calls.push(
        hitRobotHttp(`${base}/consolefunccall`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "func=LOOK_LoadFaceOverlay&args=",
        }),
      );
    }

    const results = await Promise.all(calls);
    if (results.some((r) => r === "ok" || r === "opaque")) anyOk = true;
  }

  return anyOk;
}

async function playAnimationViaLocalProxy(
  ip: string,
  animName: string,
): Promise<boolean> {
  if (!isLocalDevHost()) return false;
  try {
    const res = await fetch("/api/vector-console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, action: "play-animation", animName }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/** Play a canned animation by name (engine PlayAnimationByName / anim PlayAnimation). */
async function playAnimationViaConsole(
  ip: string,
  animName: string,
): Promise<boolean> {
  await ensureLocalNetworkAccess();

  if (await playAnimationViaLocalProxy(ip, animName)) {
    return true;
  }

  let anyOk = false;
  const encoded = encodeURIComponent(animName);

  for (const port of ENGINE_PORTS) {
    const base = `http://${ip}:${port}`;
    const calls: Array<Promise<"ok" | "opaque" | "fail">> = [
      hitRobotHttp(
        `${base}/consolefunccall?func=PlayAnimationByName&args=${encoded}`,
      ),
      hitRobotHttp(`${base}/consolefunccall`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `func=PlayAnimationByName&args=${encoded}`,
      }),
      hitRobotHttp(
        `${base}/consolefunccall?func=PlayAnimation&args=${encoded}`,
      ),
      hitRobotHttp(`${base}/consolefunccall`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `func=PlayAnimation&args=${encoded}`,
      }),
    ];
    const results = await Promise.all(calls);
    if (results.some((r) => r === "ok" || r === "opaque")) anyOk = true;
  }

  return anyOk;
}

/** Default fist-bump request anim from AnimationTriggerMap. */
export const FIST_BUMP_ANIM = "ag_fistbump_requestonce";

const CUSTOM_REMOTE_PATH = "/data/data/customFaceOverlay.jpg";

/**
 * Browser-reachable eng-console rewrite for staging a custom JPG when SSH
 * isn't available (e.g. site hosted on Vercel). Overwrites the Galaxy asset
 * and we load flavor 7 — stock Galaxy is restored from /face-overlays/galaxy.jpg
 * when the user picks Galaxy again.
 */
const CUSTOM_HTTP_STAGING = {
  flavor: 7 as const,
  uriPath: "/resources/assets/faceOverlays/galaxy.jpg",
  stockUrl: "/face-overlays/galaxy.jpg",
};

const PUT_BRIDGE_URI = "/persistent/gaze-put-bridge.html";
const PUT_BRIDGE_PUBLIC = "/robot-put-bridge.html";

export type CustomUploadResult = {
  ok: boolean;
  flavor: number;
  via: "unlock-ssh" | "http-resources" | "http-bridge";
};

export {
  RobotWriteSetupError,
  buildBridgeWriteUrl,
  buildRobotWriteSetupScript,
  copyText,
  isRobotWriteSetupError,
  openBridgeWriteTab,
  prepareRobotWriteSetup,
} from "@/lib/vector/robot-write-setup";

async function blobToBase64(jpeg: Blob): Promise<string> {
  const buf = new Uint8Array(await jpeg.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** GET from eng-console — responses include ACAO * so we can verify writes. */
async function getRobotBytes(
  ip: string,
  uriPath: string,
): Promise<ArrayBuffer | null> {
  for (const port of CONSOLE_PORTS) {
    const url = `http://${ip}:${port}${uriPath}?t=${Date.now()}`;
    try {
      const localInit: LocalFetchInit = {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        targetAddressSpace: "local",
      };
      const res = await fetch(url, localInit);
      if (res.ok) return await res.arrayBuffer();
    } catch {
      // try next port
    }
  }
  return null;
}

/**
 * PUT via the robot-origin bridge iframe (same-origin on :8889 — no CORS preflight).
 * Bridge is installed at /persistent/gaze-put-bridge.html by unlock-SSH uploads.
 */
async function putViaRobotBridge(
  ip: string,
  uriPath: string,
  jpeg: Blob,
): Promise<boolean> {
  if (typeof document === "undefined") return false;

  const jpegBase64 = await blobToBase64(jpeg);

  for (const port of CONSOLE_PORTS) {
    const ok = await new Promise<boolean>((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.setAttribute("aria-hidden", "true");
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        iframe.remove();
        resolve(value);
      };

      const timer = window.setTimeout(() => finish(false), 8000);

      const onMessage = (event: MessageEvent) => {
        const data = event.data as {
          type?: string;
          ok?: boolean;
        } | null;
        if (!data || typeof data !== "object") return;
        if (data.type === "vector-gaze-put-ready") {
          iframe.contentWindow?.postMessage(
            {
              type: "vector-gaze-put",
              path: uriPath,
              jpegBase64,
            },
            "*",
          );
          return;
        }
        if (data.type === "vector-gaze-put-result") {
          finish(Boolean(data.ok));
        }
      };

      window.addEventListener("message", onMessage);
      iframe.onload = () => {
        // If the bridge 404s, onload still fires with an error page — ready msg won't come.
        window.setTimeout(() => {
          if (!settled) {
            iframe.contentWindow?.postMessage(
              {
                type: "vector-gaze-put",
                path: uriPath,
                jpegBase64,
              },
              "*",
            );
          }
        }, 250);
      };
      iframe.onerror = () => finish(false);
      iframe.src = `http://${ip}:${port}${PUT_BRIDGE_URI}?t=${Date.now()}`;
      document.body.appendChild(iframe);
    });
    if (ok) return true;
  }
  return false;
}

/**
 * CORS PUT — only counts as success when a subsequent GET shows the new bytes.
 * Opaque / no-cors PUT is ignored (browsers can't PUT in no-cors mode anyway).
 */
async function putRobotJpegVerified(
  ip: string,
  uriPath: string,
  jpeg: Blob,
): Promise<boolean> {
  const expected = await sha256Hex(jpeg);

  // Prefer robot-origin bridge (works from Vercel once installed).
  if (await putViaRobotBridge(ip, uriPath, jpeg)) {
    const afterBridge = await getRobotBytes(ip, uriPath);
    if (afterBridge) {
      const got = await sha256Hex(new Blob([afterBridge]));
      if (got === expected) return true;
    } else {
      // Bridge reported ok but GET blocked — trust bridge same-origin PUT.
      return true;
    }
  }

  for (const port of CONSOLE_PORTS) {
    const url = `http://${ip}:${port}${uriPath}`;
    const localInit: LocalFetchInit = {
      method: "PUT",
      cache: "no-store",
      mode: "cors",
      targetAddressSpace: "local",
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.size),
      },
      body: jpeg,
    };
    try {
      await fetch(url, { ...localInit, method: "DELETE" });
    } catch {
      // ignore
    }
    try {
      const res = await fetch(url, localInit);
      if (!(res.ok || res.status === 201)) continue;
    } catch {
      continue;
    }

    const after = await getRobotBytes(ip, uriPath);
    if (!after) continue;
    const got = await sha256Hex(new Blob([after]));
    if (got === expected) return true;
  }
  return false;
}

/** True when the robot-origin put-bridge HTML is already installed. */
export async function robotPutBridgeInstalled(ip: string): Promise<boolean> {
  await ensureLocalNetworkAccess();
  const bytes = await getRobotBytes(ip, PUT_BRIDGE_URI);
  if (!bytes || bytes.byteLength < 32) return false;
  try {
    const text = new TextDecoder().decode(bytes);
    return text.includes("vector-gaze-put");
  } catch {
    return false;
  }
}

/**
 * Push a custom overlay JPG onto the robot automatically (no password / SCP).
 * 1) Local Next on the same LAN → unlock-key SSH (wipes old file, writes new)
 * 2) Otherwise → verified HTTP PUT (robot-origin bridge or CORS) into Galaxy staging
 *
 * Never reports success for flavor 8 unless SSH actually replaced the Custom file.
 */
export async function uploadCustomOverlayJpeg(
  ip: string,
  jpeg: Blob,
): Promise<CustomUploadResult | null> {
  await ensureLocalNetworkAccess();

  // Local Next can SSH with the well-known unlocked-Vector root key.
  if (isLocalDevHost()) {
    try {
      const jpegBase64 = await blobToBase64(jpeg);
      let bridgeBase64: string | undefined;
      try {
        const bridgeRes = await fetch(PUT_BRIDGE_PUBLIC, { cache: "force-cache" });
        if (bridgeRes.ok) {
          bridgeBase64 = await blobToBase64(await bridgeRes.blob());
        }
      } catch {
        // optional
      }
      const res = await fetch("/api/vector-console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          action: "overlay-upload",
          jpegBase64,
          bridgeBase64,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          via?: string;
        };
        if (data.ok && data.via === "unlock-ssh") {
          return { ok: true, flavor: 8, via: "unlock-ssh" };
        }
        // Do NOT treat unknown/http-put API success as flavor 8 — that reloads the OLD Custom file.
        if (data.ok && data.via === "http-put") {
          // Fall through to verified browser write for staging flavor.
        }
      }
    } catch {
      // fall through to browser HTTP
    }
  }

  // Vercel / remote: browser → robot LAN. Only succeed when the new bytes are verified.
  if (await putRobotJpegVerified(ip, CUSTOM_HTTP_STAGING.uriPath, jpeg)) {
    return {
      ok: true,
      flavor: CUSTOM_HTTP_STAGING.flavor,
      via: "http-bridge",
    };
  }

  // If the put-bridge is installed, open it as a top-level tab with a #gaze payload.
  // That tab is robot-origin, so PUT works without CORS — and the tab actually does work.
  if (typeof window !== "undefined" && (await robotPutBridgeInstalled(ip))) {
    try {
      const { buildBridgeWriteUrl, openBridgeWriteTab } = await import(
        "@/lib/vector/robot-write-setup"
      );
      const jpegBase64 = await blobToBase64(jpeg);
      const bridgeWriteUrl = buildBridgeWriteUrl(ip, {
        path: CUSTOM_HTTP_STAGING.uriPath,
        jpegBase64,
        opacity: 0.8,
        flavor: CUSTOM_HTTP_STAGING.flavor,
        load: false,
      });
      const wrote = await openBridgeWriteTab(bridgeWriteUrl);
      if (wrote) {
        return {
          ok: true,
          flavor: CUSTOM_HTTP_STAGING.flavor,
          via: "http-bridge",
        };
      }
      // Fallback: verify disk in case postMessage was blocked but PUT succeeded.
      const after = await getRobotBytes(ip, CUSTOM_HTTP_STAGING.uriPath);
      if (after) {
        const expected = await sha256Hex(jpeg);
        const got = await sha256Hex(new Blob([after]));
        if (got === expected) {
          return {
            ok: true,
            flavor: CUSTOM_HTTP_STAGING.flavor,
            via: "http-bridge",
          };
        }
      }
    } catch {
      // fall through
    }
  }

  // Also try staging under persistent (still load as Galaxy flavor if we can't do Custom).
  if (await putRobotJpegVerified(ip, "/persistent/customFaceOverlay.jpg", jpeg)) {
    // Persistent alone does NOT feed flavor 8. Stage into galaxy as well if possible.
    await putRobotJpegVerified(ip, CUSTOM_HTTP_STAGING.uriPath, jpeg);
    return {
      ok: true,
      flavor: CUSTOM_HTTP_STAGING.flavor,
      via: "http-resources",
    };
  }

  return null;
}

/** Restore stock Galaxy JPG on the robot (after Custom staging overwrote it). */
export async function restoreStockGalaxyOverlay(ip: string): Promise<boolean> {
  await ensureLocalNetworkAccess();
  try {
    const res = await fetch(CUSTOM_HTTP_STAGING.stockUrl, { cache: "force-cache" });
    if (!res.ok) return false;
    const blob = await res.blob();
    return putRobotJpegVerified(ip, CUSTOM_HTTP_STAGING.uriPath, blob);
  } catch {
    return false;
  }
}

export class VectorSession {
  private ble: InstanceType<typeof VectorBluetooth> | null = null;
  private handler: RtsHandler | null = null;
  private sessions = new Sessions();
  private handshakeListener = {
    receive: (data: number[]) => this.onRawReceive(data),
  };
  private version = 0;
  private pinWaiters: Array<(needsPin: boolean) => void> = [];
  private pairedWaiters: Array<() => void> = [];
  private disconnectedHandlers: Array<() => void> = [];

  info: VectorInfo | null = null;
  phase: PairPhase = "idle";
  /** Flavor last used for a successful custom image push (7 staging or 8 file). */
  lastCustomFlavor: number = 8;
  /** Last custom JPEG successfully prepared/uploaded — Apply re-writes this instead of reloading old disk. */
  lastCustomBlob: Blob | null = null;

  onPhase?: (phase: PairPhase) => void;
  onDisconnected?: () => void;

  private setPhase(phase: PairPhase) {
    this.phase = phase;
    this.onPhase?.(phase);
  }

  async connect() {
    if (!bluetoothSupported()) {
      throw new Error(
        "Web Bluetooth is not available. Use Chrome or Edge on a computer or Android, over HTTPS.",
      );
    }

    if (!sodium) {
      sodium = (await import("libsodium-wrappers")).default;
    }
    await sodium.ready;
    this.cleanupHandler();
    this.ble = new VectorBluetooth();
    this.ble.onReceive(this.handshakeListener);
    this.ble.onDisconnected(() => {
      this.setPhase("disconnected");
      this.onDisconnected?.();
      for (const fn of this.disconnectedHandlers) fn();
    });

    this.setPhase("scanning");

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      this.ble!.onCancelSelect(() => {
        this.setPhase("idle");
        finish(new Error("No Vector selected. Double-click his backpack and try again."));
      });

      const previous = this.handshakeListener.receive;
      this.handshakeListener.receive = (data: number[]) => {
        previous.call(this.handshakeListener, data);
        if (data[0] === 1 && data.length === 5) {
          finish();
        }
      };

      this.ble!.tryConnect(null);

      window.setTimeout(() => {
        if (this.handler || this.phase !== "scanning") return;
        finish(
          new Error(
            "Vector never finished the BLE handshake. Double-click his backpack so the key PIN is on screen, then try again.",
          ),
        );
      }, 20000);
    });

    this.setPhase("handshaking");
  }

  private onRawReceive(data: number[]) {
    if (data[0] === 1 && data.length === 5 && !this.handler) {
      const version = IntBuffer.BufferToUInt32(data.slice(1));
      this.startHandler(version);
    }
  }

  private startHandler(version: number) {
    if (!this.ble) return;
    this.version = version;
    const Handler = {
      2: RtsV2Handler,
      3: RtsV3Handler,
      4: RtsV4Handler,
      5: RtsV5Handler,
      6: RtsV6Handler,
    }[version];

    if (!Handler) {
      this.ble.tryDisconnect();
      throw new Error(`Vector spoke RTS v${version}, which this site does not support.`);
    }

    this.handler = new Handler(this.ble, sodium, this.sessions) as RtsHandler;
    this.handler.onReadyForPin(() => {
      this.setPhase("need-pin");
      for (const wait of this.pinWaiters.splice(0)) wait(true);
    });
    this.handler.onEncryptedConnection(() => {
      this.setPhase("authorizing");
      for (const wait of this.pinWaiters.splice(0)) wait(false);
      for (const wait of this.pairedWaiters.splice(0)) wait();
    });

    this.ble.send(generateHandshakeMessage(version));
  }

  waitForPinPrompt() {
    if (this.phase === "need-pin") return Promise.resolve(true);
    if (this.phase === "authorizing" || this.phase === "paired") {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(
          new Error(
            "Vector connected but never asked for a PIN. Double-click the backpack so the key screen is up, then find him again.",
          ),
        );
      }, 20000);
      this.pinWaiters.push((needsPin) => {
        window.clearTimeout(timeout);
        resolve(needsPin);
      });
    });
  }

  async submitPin(pin: string) {
    const cleaned = pin.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleaned)) {
      throw new Error("Enter the 6-digit code from Vector’s screen.");
    }
    if (!this.handler) {
      throw new Error("Vector is not waiting for a PIN yet.");
    }
    this.setPhase("authorizing");
    const paired = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(
          new Error(
            "PIN was rejected or pairing timed out. Double-click his backpack and try again.",
          ),
        );
      }, 15000);
      this.pairedWaiters.push(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
    this.handler.enterPin(cleaned);
    await paired;
    await this.refreshInfo();
    this.setPhase("paired");
  }

  async refreshInfo() {
    if (!this.handler) return;
    const status = await this.handler.doStatus();
    const value = status.value;
    let ip: string | undefined;
    if (this.handler.doWifiIp) {
      try {
        const wifi = await this.handler.doWifiIp();
        ip = formatIpv4(wifi.value.ipV4);
      } catch {
        ip = undefined;
      }
    }

    const name = this.ble?.bleName || "Vector";
    this.info = {
      name,
      esn: value.esn,
      build: value.version?.split("-")[0],
      wifiSsid: hexSsid(value.wifiSsidHex),
      wifiConnected: value.wifiState === 1 || value.wifiState === 2,
      ip,
      rtsVersion: this.version,
      supportsSdkProxy: typeof this.handler.doSdk === "function",
      hasOwner: value.hasOwner,
      isCloudAuthed: value.isCloudAuthed,
    };
    return this.info;
  }

  /**
   * Change eye color via unlocked CFW local console (no cloud / Wire-Pod).
   */
  async setEyeColor(hue: number, saturation: number): Promise<SdkResult> {
    await this.refreshInfo();
    const ip = this.info?.ip;

    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try the wheel again.",
      );
    }

    const ok = await setEyeColorViaConsole(ip, hue, saturation);
    if (!ok) {
      throw new Error(
        `Couldn’t reach Vector at ${ip}:8889. Same Wi-Fi required. In Chrome click Allow for local network access (Vercel HTTPS → robot).`,
      );
    }

    return {
      statusCode: 200,
      path: "/consolefunccall",
      via: "console",
    };
  }

  /**
   * Change master volume via unlocked CFW engine console (DebugSetMasterVolume).
   */
  async setVolume(level: VolumeLevel): Promise<SdkResult> {
    if (!Number.isInteger(level) || level < 0 || level > 5) {
      throw new Error("Volume must be an integer from 0 (mute) to 5 (high).");
    }

    await this.refreshInfo();
    const ip = this.info?.ip;

    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try volume again.",
      );
    }

    const ok = await setVolumeViaConsole(ip, level);
    if (!ok) {
      throw new Error(
        `Couldn’t reach Vector’s engine console at ${ip}:8888 for volume. Same Wi-Fi + Allow local network access.`,
      );
    }

    return {
      statusCode: 200,
      path: "/consolefunccall?func=DebugSetMasterVolume",
      via: "console",
    };
  }

  /** Offer a fist bump (plays ag_fistbump_requestonce on the eng console). */
  async fistBump(): Promise<SdkResult> {
    await this.refreshInfo();
    const ip = this.info?.ip;
    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try again.",
      );
    }

    const ok = await playAnimationViaConsole(ip, FIST_BUMP_ANIM);
    if (!ok) {
      throw new Error(
        `Couldn’t reach Vector at ${ip} to play fist bump. Same Wi-Fi + Allow local network access.`,
      );
    }

    return {
      statusCode: 200,
      path: `/consolefunccall?func=PlayAnimationByName&args=${FIST_BUMP_ANIM}`,
      via: "console",
    };
  }

  /**
   * Face overlay from unlocked CFW Face console menu
   * (ProcFace_CustomEyes + FlavorOfGay + LOOK_LoadFaceOverlay).
   */
  async setEyeOverlay(
    flavor: number | null,
    opacity = 0.8,
  ): Promise<SdkResult> {
    if (flavor !== null && (!Number.isInteger(flavor) || flavor < 0 || flavor > 8)) {
      throw new Error("Overlay flavor must be null (off) or 0–8.");
    }

    await this.refreshInfo();
    const ip = this.info?.ip;

    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try overlays again.",
      );
    }

    const ok = await setEyeOverlayViaConsole(ip, flavor, opacity);
    if (!ok) {
      throw new Error(
        `Couldn’t reach Vector’s face console at ${ip}:8889 for overlays. Same Wi-Fi + Allow local network access.`,
      );
    }

    return {
      statusCode: 200,
      path: "/consolefunccall?func=LOOK_LoadFaceOverlay",
      via: "console",
    };
  }

  /**
   * Push the new JPG automatically, then switch the face to it (replacing whatever
   * was showing). No SSH password / SCP — unlock-key SSH (local) or HTTP staging.
   * Does not wipe first: if the write fails, the previous face stays put.
   */
  async replaceCustomOverlay(
    jpeg: Blob,
    opacity = 0.8,
  ): Promise<SdkResult> {
    const { prepareRobotWriteSetup } = await import(
      "@/lib/vector/robot-write-setup"
    );

    await this.refreshInfo();
    const ip = this.info?.ip;
    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try the custom overlay again.",
      );
    }

    // 1) Write the new image first (verified). Keep the old face if this fails.
    const uploaded = await uploadCustomOverlayJpeg(ip, jpeg);
    if (!uploaded) {
      const jpegBase64 = await blobToBase64(jpeg);
      throw await prepareRobotWriteSetup(ip, jpegBase64, opacity);
    }

    // 2) Load only the flavor that matches the verified write target.
    // Switching CustomEyes off→on (or flavor change) replaces the previous overlay.
    const ok = await setEyeOverlayViaConsole(ip, uploaded.flavor, opacity);
    if (!ok) {
      throw new Error(
        `New overlay file was written (${uploaded.via}) but LOOK_LoadFaceOverlay didn’t reach ${ip}:8889.`,
      );
    }

    this.lastCustomFlavor = uploaded.flavor;
    this.lastCustomBlob = jpeg;

    await new Promise((r) => setTimeout(r, 200));
    await setEyeOverlayViaConsole(ip, uploaded.flavor, opacity);

    return {
      statusCode: 200,
      path:
        uploaded.flavor === 8
          ? CUSTOM_REMOTE_PATH
          : CUSTOM_HTTP_STAGING.uriPath,
      via: "console",
    };
  }

  /**
   * Opacity / Apply for custom: always re-upload the last blob so we never
   * resurrect an old on-disk Custom file without replacing it.
   */
  async reloadCustomOverlay(opacity = 0.8, jpeg?: Blob): Promise<SdkResult> {
    const blob = jpeg ?? this.lastCustomBlob;
    if (blob) {
      return this.replaceCustomOverlay(blob, opacity);
    }
    await this.refreshInfo();
    const ip = this.info?.ip;
    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try overlays again.",
      );
    }
    // No blob in memory — refuse to blindly reload flavor 8 (old disk image).
    if (this.lastCustomFlavor === 8) {
      throw new Error(
        "Pick your custom image again so we can rewrite it on the robot (won’t reuse the old file).",
      );
    }
    const ok = await setEyeOverlayViaConsole(ip, this.lastCustomFlavor, opacity);
    if (!ok) {
      throw new Error(
        `Couldn’t reach Vector’s face console at ${ip}:8889 for overlays. Same Wi-Fi + Allow local network access.`,
      );
    }
    return {
      statusCode: 200,
      path: "/consolefunccall?func=LOOK_LoadFaceOverlay",
      via: "console",
    };
  }

  /** Restore stock Galaxy asset on the robot, then load it. */
  async setGalaxyOverlay(opacity = 0.8): Promise<SdkResult> {
    await this.refreshInfo();
    const ip = this.info?.ip;
    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try overlays again.",
      );
    }
    await restoreStockGalaxyOverlay(ip);
    return this.setEyeOverlay(CUSTOM_HTTP_STAGING.flavor, opacity);
  }

  /** Push a prepared 184×96 JPEG for the Custom overlay slot. */
  async uploadCustomOverlay(jpeg: Blob): Promise<boolean> {
    await this.refreshInfo();
    const ip = this.info?.ip;
    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try the custom overlay again.",
      );
    }
    const result = await uploadCustomOverlayJpeg(ip, jpeg);
    return Boolean(result?.ok);
  }

  disconnect() {
    this.ble?.tryDisconnect();
    this.cleanupHandler();
    this.setPhase("idle");
  }

  private cleanupHandler() {
    this.handler?.cleanup();
    this.handler = null;
  }
}
