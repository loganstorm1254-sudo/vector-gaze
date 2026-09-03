import sodium from "libsodium-wrappers";

import { RtsCliUtil } from "@/vendor/vector-rts/rtsCliUtil.js";
import { IntBuffer } from "@/vendor/vector-rts/clad.js";
import { Sessions } from "@/vendor/vector-rts/sessions.js";
import { VectorBluetooth } from "@/vendor/vector-rts/vectorBluetooth.js";
import { RtsV2Handler } from "@/vendor/vector-rts/rtsV2Handler.js";
import { RtsV3Handler } from "@/vendor/vector-rts/rtsV3Handler.js";
import { RtsV4Handler } from "@/vendor/vector-rts/rtsV4Handler.js";
import { RtsV5Handler } from "@/vendor/vector-rts/rtsV5Handler.js";
import { RtsV6Handler } from "@/vendor/vector-rts/rtsV6Handler.js";

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
};

type StatusValue = {
  wifiState?: number;
  wifiSsidHex?: string;
  esn?: string;
  version?: string;
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

const GUID_KEY = "vector-eyes-sdk-guid";

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
    };
    return this.info;
  }

  async setEyeColor(hue: number, saturation: number, guidOverride?: string) {
    if (!this.handler?.doSdk) {
      throw new Error(
        "This Vector firmware cannot change eye color over BLE. Update him, then pair again.",
      );
    }
    const guid =
      (guidOverride ?? getStoredSdkGuid()).trim() ||
      "00000000-0000-0000-0000-000000000000";
    const response = await this.handler.doSdk(
      guid,
      RtsCliUtil.makeId(),
      "/v1/set_eye_color",
      JSON.stringify({ hue, saturation }),
    );
    const result: SdkResult = {
      statusCode: Number(response.value.statusCode ?? 0),
      responseType: response.value.responseType,
      responseBody: response.value.responseBody,
    };
    if (result.statusCode && result.statusCode !== 200) {
      const err = new Error(
        result.statusCode === 401 || result.statusCode === 403
          ? "Vector accepted the PIN, but his SDK gateway wants a client guid. Paste the guid from ~/.anki_vector/sdk_config.ini."
          : `Vector returned ${result.statusCode} for set_eye_color.`,
      );
      (err as Error & { sdk: SdkResult }).sdk = result;
      throw err;
    }
    return result;
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
