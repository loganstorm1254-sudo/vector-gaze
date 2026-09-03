import { RtsCliUtil } from "@/vendor/vector-rts/rtsCliUtil.js";
import { IntBuffer } from "@/vendor/vector-rts/clad.js";
import { Sessions } from "@/vendor/vector-rts/sessions.js";
import { VectorBluetooth } from "@/vendor/vector-rts/vectorBluetooth.js";
import { RtsV2Handler } from "@/vendor/vector-rts/rtsV2Handler.js";
import { RtsV3Handler } from "@/vendor/vector-rts/rtsV3Handler.js";
import { RtsV4Handler } from "@/vendor/vector-rts/rtsV4Handler.js";
import { RtsV5Handler } from "@/vendor/vector-rts/rtsV5Handler.js";
import { RtsV6Handler } from "@/vendor/vector-rts/rtsV6Handler.js";

// libsodium-wrappers is CommonJS; load after sodium.ready in connect().
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
};

export type SdkResult = {
  statusCode: number;
  responseType?: string;
  responseBody?: string;
  path: string;
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
  doAnkiAuth?: (sessionToken: string) => Promise<{ value: CloudAuthValue }>;
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

type CloudAuthValue = {
  success?: boolean;
  statusCode?: number;
  clientTokenGuid?: string;
};

const GUID_KEY = "vector-eyes-sdk-guid";

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

export function getStoredSdkGuid() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(GUID_KEY) ?? "";
}

export function storeSdkGuid(guid: string) {
  window.localStorage.setItem(GUID_KEY, guid.trim());
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

function describeSdkFailure(result: SdkResult) {
  const body = (result.responseBody || "").trim();
  if (result.statusCode === 401 || result.statusCode === 403) {
    return "Vector rejected the SDK guid. Paste the guid= line from ~/.anki_vector/sdk_config.ini (or your WirePod token), then Apply again.";
  }
  if (result.statusCode === 0) {
    return "Vector returned an empty SDK response. His BLE SDK proxy needs a valid client guid before eye color will stick.";
  }
  return `Vector returned HTTP ${result.statusCode} for ${result.path}${body ? `: ${body.slice(0, 180)}` : ""}`;
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
  private clientGuid = "";

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
    this.clientGuid = getStoredSdkGuid();
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
    };
    return this.info;
  }

  /**
   * Authorize the BLE SDK proxy with an Anki/DDL/WirePod session token.
   * On success, stores the returned clientTokenGuid for eye-color calls.
   */
  async authorizeCloud(sessionToken: string) {
    if (!this.handler?.doAnkiAuth) {
      throw new Error("This Vector firmware cannot run cloud auth over BLE.");
    }
    const token = sessionToken.trim();
    if (!token) throw new Error("Paste a session token or SDK guid first.");

    // If it already looks like a client guid, just store it.
    if (token.length >= 16 && !token.includes(" ")) {
      this.clientGuid = token;
      storeSdkGuid(token);
      return { guid: token, via: "guid" as const };
    }

    const msg = await this.handler.doAnkiAuth(token);
    const value = msg.value;
    if (!value.success || !value.clientTokenGuid) {
      throw new Error(
        `Cloud auth failed (status ${value.statusCode ?? "?"}). Use the guid= value from sdk_config.ini instead.`,
      );
    }
    this.clientGuid = value.clientTokenGuid;
    storeSdkGuid(value.clientTokenGuid);
    return { guid: value.clientTokenGuid, via: "cloud" as const };
  }

  private async sdkCall(
    guid: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<SdkResult> {
    if (!this.handler?.doSdk) {
      throw new Error(
        "This Vector firmware cannot change eye color over BLE. Update him, then pair again.",
      );
    }
    if (!guid.trim()) {
      throw new Error(
        "Missing SDK guid. Paste guid= from ~/.anki_vector/sdk_config.ini, then hit Apply.",
      );
    }

    let response: { value: SdkProxyValue };
    try {
      response = await this.handler.doSdk(
        guid.trim(),
        RtsCliUtil.makeId(),
        path,
        JSON.stringify(body),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "SDK proxy request failed.";
      // RtsResponse NotCloudAuthorized often lands here once waitForResponse is set.
      if (/not cloud authorized|unauthorized|timeout/i.test(message)) {
        throw new Error(
          "Vector says the SDK proxy is not authorized. Paste a valid guid from sdk_config.ini (or authorize with a WirePod/Anki session token).",
        );
      }
      throw err instanceof Error ? err : new Error(message);
    }

    return {
      statusCode: Number(response.value.statusCode ?? 0),
      responseType: response.value.responseType,
      responseBody: response.value.responseBody,
      path,
    };
  }

  async setEyeColor(hue: number, saturation: number, guidOverride?: string) {
    const guid = (guidOverride ?? this.clientGuid ?? getStoredSdkGuid()).trim();
    if (!guid) {
      throw new Error(
        "Eye color needs your SDK guid. Pairing alone is not enough — paste guid= from ~/.anki_vector/sdk_config.ini below, then Apply.",
      );
    }
    this.clientGuid = guid;
    storeSdkGuid(guid);

    // 1) Temporary RGB via SDK (what the Python SDK uses).
    const rgb = await this.sdkCall(guid, "/v1/set_eye_color", {
      hue,
      saturation,
    });
    if (rgb.statusCode !== 200) {
      throw Object.assign(new Error(describeSdkFailure(rgb)), { sdk: rgb });
    }

    // 2) Also push the nearest permanent preset so idle behavior doesn't snap back.
    const preset = nearestEyeColorEnum(hue, saturation);
    try {
      const settings = await this.sdkCall(guid, "/v1/update_settings", {
        settings: { eye_color: preset.enum },
      });
      if (settings.statusCode !== 200) {
        // Non-fatal: RGB call already succeeded.
        return {
          ...rgb,
          responseBody: `${rgb.responseBody || ""} | preset ${preset.name} status ${settings.statusCode}`,
        };
      }
    } catch {
      // Ignore preset failure if RGB worked.
    }

    return rgb;
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
