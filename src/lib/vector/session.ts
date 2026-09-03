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
  via: "console" | "sdk";
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

// Unlocked / CFW eng console ports (anim owns the face).
const CONSOLE_PORTS = [8889, 8888] as const;

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

/**
 * Fire-and-forget HTTP to Vector's LAN eng console.
 * Works without Wire-Pod / Anki / Escape Pod — unlocked CFW exposes these.
 * Tries CORS fetch, no-cors fetch, then image beacons (helps HTTPS→HTTP).
 */
async function hitRobotHttp(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, {
      ...init,
      mode: "cors",
      cache: "no-store",
    });
    if (res.ok || res.status === 200) return true;
    // Some eng builds return 200 with text/html body either way.
    if (res.status > 0 && res.status < 500) return true;
  } catch {
    // fall through
  }

  try {
    await fetch(url, {
      ...init,
      mode: "no-cors",
      cache: "no-store",
    });
    // Opaque response — assume the packet left the browser.
    return true;
  } catch {
    // fall through
  }

  // Passive beacon: passive mixed content often still allowed from HTTPS pages.
  if (!init || !init.method || init.method.toUpperCase() === "GET") {
    await new Promise<boolean>((resolve) => {
      const img = new Image();
      const done = () => resolve(true);
      img.onload = done;
      img.onerror = done;
      img.src = url;
      window.setTimeout(done, 800);
    });
    return true;
  }

  return false;
}

async function setEyeColorViaLocalProxy(
  ip: string,
  hue: number,
  saturation: number,
): Promise<boolean> {
  try {
    const res = await fetch("/api/vector-console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, hue, saturation }),
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
  // When Next is running on your machine, the API route can reach Vector even
  // if the browser blocks private-network HTTP.
  if (await setEyeColorViaLocalProxy(ip, hue, saturation)) {
    return true;
  }

  const h = Number(hue.toFixed(4));
  const s = Number(saturation.toFixed(4));
  let anyOk = false;

  for (const port of CONSOLE_PORTS) {
    const base = `http://${ip}:${port}`;

    // Preferred: console functions call SetHue/SetSaturation (updates face images).
    const hueFn = `${base}/consolefunccall?func=ProcFace_Hue&args=${encodeURIComponent(String(h))}`;
    const satFn = `${base}/consolefunccall?func=ProcFace_Saturation&args=${encodeURIComponent(String(s))}`;
    const hueVar = `${base}/consolevarset?key=${encodeURIComponent("kProcFace_Hue")}&value=${encodeURIComponent(String(h))}`;
    const satVar = `${base}/consolevarset?key=${encodeURIComponent("kProcFace_Saturation")}&value=${encodeURIComponent(String(s))}`;

    const results = await Promise.all([
      hitRobotHttp(hueFn),
      hitRobotHttp(satFn),
      hitRobotHttp(hueVar),
      hitRobotHttp(satVar),
      // POST variants (jquery-style) for builds that ignore GET bodies.
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

    if (results.some(Boolean)) anyOk = true;
  }

  return anyOk;
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
   * Change eye color with zero cloud / Wire-Pod.
   * Unlocked CFW: hit Vector's local eng console over LAN.
   * Fallback: BLE SDK proxy with an empty token (some CFWs allow it).
   */
  async setEyeColor(hue: number, saturation: number): Promise<SdkResult> {
    await this.refreshInfo();
    const ip = this.info?.ip;

    if (ip) {
      const ok = await setEyeColorViaConsole(ip, hue, saturation);
      if (ok) {
        return {
          statusCode: 200,
          path: "/consolefunccall",
          via: "console",
        };
      }
    }

    // Last-ditch: BLE SDK with no token. Some unlocked CFWs skip gateway auth.
    if (this.handler?.doSdk) {
      try {
        const response = await this.handler.doSdk(
          "",
          RtsCliUtil.makeId(),
          "/v1/set_eye_color",
          JSON.stringify({ hue, saturation }),
        );
        const statusCode = Number(response.value.statusCode ?? 0);
        if (statusCode === 200) {
          try {
            await this.handler.doSdk(
              "",
              RtsCliUtil.makeId(),
              "/v1/update_settings",
              JSON.stringify({
                update_settings: true,
                settings: {
                  custom_eye_color: { enabled: true, hue, saturation },
                },
              }),
            );
          } catch {
            // live color is enough
          }
          return {
            statusCode: 200,
            path: "/v1/set_eye_color",
            via: "sdk",
          };
        }
      } catch {
        // continue to error below
      }
    }

    if (!ip) {
      throw new Error(
        "Paired over BLE but Vector has no Wi-Fi IP yet. Put him on your network, then try the wheel again.",
      );
    }

    throw new Error(
      `Couldn’t reach Vector’s local console at ${ip}:8889. Stay on the same Wi-Fi. Unlocked CFW must expose the eng console (ports 8888/8889).`,
    );
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
