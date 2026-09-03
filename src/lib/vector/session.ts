import { RtsCliUtil } from "@/vendor/vector-rts/rtsCliUtil.js";
import { IntBuffer } from "@/vendor/vector-rts/clad.js";
import { Sessions } from "@/vendor/vector-rts/sessions.js";
import { VectorBluetooth } from "@/vendor/vector-rts/vectorBluetooth.js";
import { RtsV2Handler } from "@/vendor/vector-rts/rtsV2Handler.js";
import { RtsV3Handler } from "@/vendor/vector-rts/rtsV3Handler.js";
import { RtsV4Handler } from "@/vendor/vector-rts/rtsV4Handler.js";
import { RtsV5Handler } from "@/vendor/vector-rts/rtsV5Handler.js";
import { RtsV6Handler } from "@/vendor/vector-rts/rtsV6Handler.js";

/**
 * Escape Pod session token (same value Wire-Pod and official Escape Pod use).
 * Only works when Vector can reach a local Escape Pod cloud at escapepod.local.
 */
const ESCAPE_POD_SESSION_TOKEN = "2vMhFgktH3Jrbemm2WHkfGN";

/**
 * Wire-Pod / Escape Pod default SDK guid used when a bot was activated with
 * the shared primary token. Harmless to try; ignored if the bot never had it.
 */
const ESCAPE_POD_GLOBAL_GUID = "tni1TRsTRTaNSapjo0Y+Sw==";

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
  looksLikeEscapePod: boolean;
};

export type SdkResult = {
  statusCode: number;
  responseType?: string;
  responseBody?: string;
  path: string;
};

export type CloudAuthStatus =
  | { ok: true; guid: string; source: "stored" | "global" | "cloud" | "manual" }
  | { ok: false; statusCode?: number; detail: string };

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

const CLOUD_STATUS: Record<number, string> = {
  0: "UnknownError",
  1: "ConnectionError",
  2: "WrongAccount",
  3: "InvalidSessionToken",
  4: "AuthorizedAsPrimary",
  5: "AuthorizedAsSecondary",
  6: "ReassociatedPrimary",
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

function looksLikeEscapePod(build?: string) {
  if (!build) return false;
  return /ep\b/i.test(build) || /escapepod/i.test(build);
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

export function clearStoredSdkGuid() {
  window.localStorage.removeItem(GUID_KEY);
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

function cloudAuthFailureMessage(statusCode?: number, epFirmware?: boolean) {
  const label =
    statusCode === undefined
      ? "unknown"
      : `${CLOUD_STATUS[statusCode] ?? "Unknown"} (${statusCode})`;

  if (statusCode === 1) {
    return (
      `Vector couldn’t reach his cloud (${label}). ` +
      (epFirmware
        ? "His firmware is Escape Pod style, so he looks for escapepod.local on your LAN. That is official Escape Pod or Wire-Pod — without a local Escape Pod server running, minting a new SDK token fails. Anki’s cloud is gone."
        : "Anki’s cloud is gone. Unlocked / CFW bots still need either a local Escape Pod server (escapepod.local) or an SDK guid that was minted earlier.")
    );
  }

  if (statusCode === 3) {
    return `Vector rejected the session token (${label}). Use an Escape Pod / Wire-Pod session, or paste an existing SDK guid.`;
  }

  return `Cloud auth failed (${label}). Unlocked CFW does not skip SDK auth — PIN only unlocks BLE.`;
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
  private guidProven = false;

  info: VectorInfo | null = null;
  phase: PairPhase = "idle";
  lastAuthError: string | null = null;

  onPhase?: (phase: PairPhase) => void;
  onDisconnected?: () => void;

  get hasSdkGuid() {
    return Boolean(this.clientGuid || getStoredSdkGuid());
  }

  get sdkReady() {
    return this.guidProven && Boolean(this.clientGuid);
  }

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
    this.guidProven = false;
    this.lastAuthError = null;
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
    // Soft prep only — do not require Escape Pod / Wire-Pod cloud.
    await this.prepareSdkGuid();
    this.setPhase("paired");
  }

  /**
   * Pick the best guid we already have. Does not call Escape Pod cloud.
   * Unlocked CFW without a local Escape Pod server cannot mint a new token.
   */
  async prepareSdkGuid(): Promise<CloudAuthStatus> {
    const stored = getStoredSdkGuid().trim();
    if (stored) {
      this.clientGuid = stored;
      return { ok: true, guid: stored, source: "stored" };
    }

    // Try the shared Escape Pod / Wire-Pod primary guid. Works only if this
    // bot was activated against that token set before.
    this.clientGuid = ESCAPE_POD_GLOBAL_GUID;
    return { ok: true, guid: ESCAPE_POD_GLOBAL_GUID, source: "global" };
  }

  useManualGuid(guid: string): CloudAuthStatus {
    const cleaned = guid.trim();
    if (cleaned.length < 8) {
      return {
        ok: false,
        detail: "That doesn’t look like an SDK guid. Paste the guid= value from sdk_config.ini.",
      };
    }
    this.clientGuid = cleaned;
    this.guidProven = false;
    storeSdkGuid(cleaned);
    this.lastAuthError = null;
    return { ok: true, guid: cleaned, source: "manual" };
  }

  /**
   * Mint a client token via Escape Pod cloud over BLE.
   * Requires Vector to resolve escapepod.local (official Escape Pod or Wire-Pod).
   * Not needed if you already have a working guid.
   */
  async authorizeWithEscapePodCloud(): Promise<CloudAuthStatus> {
    if (!this.handler?.doAnkiAuth) {
      const detail =
        "This firmware has no BLE cloud-auth command. Paste an SDK guid instead.";
      this.lastAuthError = detail;
      return { ok: false, detail };
    }

    const msg = await this.handler.doAnkiAuth(ESCAPE_POD_SESSION_TOKEN);
    const value = msg.value;
    if (!value?.success || !value.clientTokenGuid) {
      const detail = cloudAuthFailureMessage(
        value?.statusCode,
        this.info?.looksLikeEscapePod,
      );
      this.lastAuthError = detail;
      return { ok: false, statusCode: value?.statusCode, detail };
    }

    this.clientGuid = value.clientTokenGuid;
    this.guidProven = true;
    storeSdkGuid(value.clientTokenGuid);
    this.lastAuthError = null;
    return { ok: true, guid: value.clientTokenGuid, source: "cloud" };
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

    const build = value.version?.split("-")[0];
    const name = this.ble?.bleName || "Vector";
    this.info = {
      name,
      esn: value.esn,
      build,
      wifiSsid: hexSsid(value.wifiSsidHex),
      wifiConnected: value.wifiState === 1 || value.wifiState === 2,
      ip,
      rtsVersion: this.version,
      supportsSdkProxy: typeof this.handler.doSdk === "function",
      hasOwner: value.hasOwner,
      isCloudAuthed: value.isCloudAuthed,
      looksLikeEscapePod: looksLikeEscapePod(value.version) || looksLikeEscapePod(build),
    };
    return this.info;
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

    let response: { value: SdkProxyValue };
    try {
      response = await this.handler.doSdk(
        guid,
        RtsCliUtil.makeId(),
        path,
        JSON.stringify(body),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "SDK proxy request failed.";
      if (/not cloud authorized|unauthorized|timeout/i.test(message)) {
        throw new Error(
          "Vector’s SDK proxy rejected the token. Paste a guid from sdk_config.ini, or run Escape Pod / Wire-Pod on the LAN and use “Authorize with Escape Pod cloud”.",
        );
      }
      throw err instanceof Error ? err : new Error(message);
    }

    const statusCode = Number(response.value.statusCode ?? 0);
    if (statusCode === 401 || statusCode === 403) {
      throw new Error(
        `Vector returned HTTP ${statusCode} — that guid is not authorized on this bot. Paste the matching guid from sdk_config.ini, or mint a new one with Escape Pod cloud.`,
      );
    }

    return {
      statusCode,
      responseType: response.value.responseType,
      responseBody: response.value.responseBody,
      path,
    };
  }

  async setEyeColor(hue: number, saturation: number) {
    if (!this.clientGuid) {
      await this.prepareSdkGuid();
    }
    const guid = this.clientGuid || getStoredSdkGuid();
    if (!guid) {
      throw new Error(
        "No SDK token yet. Paste a guid, or authorize with Escape Pod cloud if you run one on the LAN.",
      );
    }

    const custom = await this.sdkCall(guid, "/v1/update_settings", {
      update_settings: true,
      settings: {
        custom_eye_color: {
          enabled: true,
          hue,
          saturation,
        },
      },
    });

    if (custom.statusCode === 200) {
      this.guidProven = true;
      storeSdkGuid(guid);
      try {
        await this.sdkCall(guid, "/v1/set_eye_color", { hue, saturation });
      } catch {
        // Permanent settings write is enough.
      }
      return custom;
    }

    const rgb = await this.sdkCall(guid, "/v1/set_eye_color", {
      hue,
      saturation,
    });
    if (rgb.statusCode !== 200) {
      throw new Error(
        `Vector returned ${custom.statusCode} for custom color and ${rgb.statusCode} for set_eye_color.`,
      );
    }

    this.guidProven = true;
    storeSdkGuid(guid);

    const preset = nearestEyeColorEnum(hue, saturation);
    try {
      await this.sdkCall(guid, "/v1/update_settings", {
        update_settings: true,
        settings: {
          custom_eye_color: { enabled: false },
          eye_color: preset.value,
        },
      });
    } catch {
      // ignore
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
