"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bluetooth, KeyRound, Loader2, Wifi } from "lucide-react";

import { ColorWheel } from "@/components/color-wheel";
import { VectorFace } from "@/components/vector-face";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { VECTOR_PRESETS, type Hs } from "@/lib/vector/color";
import {
  bluetoothSupported,
  EYE_COLOR_ENUM,
  getStoredSdkGuid,
  storeSdkGuid,
  VectorSession,
  type PairPhase,
  type VectorInfo,
} from "@/lib/vector/session";

type UiPhase = "landing" | "pin" | "eyes";

export function VectorApp({ demo = false }: { demo?: boolean }) {
  const sessionRef = useRef<VectorSession | null>(null);
  const [phase, setPhase] = useState<UiPhase>("landing");
  const [pairPhase, setPairPhase] = useState<PairPhase>("idle");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<VectorInfo | null>(
    demo
      ? {
          name: "Vector-A1B2",
          esn: "00e20100",
          build: "1.8.1",
          wifiSsid: "Home",
          wifiConnected: true,
          ip: "192.168.1.64",
          rtsVersion: 6,
          supportsSdkProxy: true,
        }
      : null,
  );
  const [hs, setHs] = useState<Hs>({ hue: 0.42, saturation: 1 });
  const [guid, setGuid] = useState("");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [bleOk, setBleOk] = useState(false);
  const sendTimer = useRef<number | null>(null);

  useEffect(() => {
    setBleOk(bluetoothSupported());
    setGuid(getStoredSdkGuid());
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.disconnect();
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (demo) return "Preview";
    switch (pairPhase) {
      case "scanning":
        return "Looking over BLE";
      case "handshaking":
        return "Talking to Vector";
      case "need-pin":
        return "Waiting for PIN";
      case "authorizing":
        return "Checking PIN";
      case "paired":
        return "Paired";
      case "disconnected":
        return "Disconnected";
      default:
        return "Idle";
    }
  }, [demo, pairPhase]);

  async function findVector() {
    if (demo) {
      setPhase("eyes");
      setPairPhase("paired");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const session = new VectorSession();
      sessionRef.current = session;
      session.onPhase = setPairPhase;
      session.onDisconnected = () => {
        setPhase("landing");
        setError(
          "Vector dropped the Bluetooth link. Double-click his backpack and pair again.",
        );
      };
      await session.connect();
      const needsPin = await session.waitForPinPrompt();
      setBusy(false);
      if (needsPin) {
        setPhase("pin");
        return;
      }
      setInfo(session.info);
      setPhase("eyes");
    } catch (err) {
      setBusy(false);
      setPairPhase("idle");
      setError(err instanceof Error ? err.message : "Could not find Vector.");
    }
  }

  async function pairWithPin() {
    const session = sessionRef.current;
    if (!session) return;
    setError(null);
    setBusy(true);
    try {
      await session.submitPin(pin);
      setInfo(session.info);
      setPhase("eyes");
      if (!getStoredSdkGuid() && !guid) {
        setError(
          "Paired. Eye color still needs your SDK guid — paste guid= from ~/.anki_vector/sdk_config.ini, then Apply color.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  function queueEyeColor(next: Hs) {
    setHs(next);
    if (demo) {
      setLastSent("Preview only — connect a real Vector to push this color.");
      return;
    }
    if (!(guid || getStoredSdkGuid()).trim()) {
      setError(
        "Add your SDK guid below before colors will reach Vector. Pairing the PIN is only step one.",
      );
      return;
    }
    if (sendTimer.current) window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => {
      void pushEyeColor(next);
    }, 280);
  }

  async function pushEyeColor(next: Hs, guidOverride?: string) {
    const session = sessionRef.current;
    if (!session) return;
    const useGuid = (guidOverride ?? guid).trim();
    if (!useGuid) {
      setError(
        "Paste the guid= value from ~/.anki_vector/sdk_config.ini, then Apply color.",
      );
      return;
    }
    setSending(true);
    setLastSent("Sending to Vector…");
    try {
      storeSdkGuid(useGuid);
      const result = await session.setEyeColor(
        next.hue,
        next.saturation,
        useGuid,
      );
      setLastSent(
        `Applied (SDK ${result.statusCode}). Watch his face — temporary RGB plus nearest permanent preset.`,
      );
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not set eye color.";
      setError(message);
      setLastSent(null);
    } finally {
      setSending(false);
    }
  }

  function disconnect() {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setPhase("landing");
    setPairPhase("idle");
    setPin("");
    setLastSent(null);
    setError(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-teal-300/80 uppercase">
            Anki Vector
          </p>
          <h1 className="font-heading text-3xl text-white sm:text-4xl">
            Eye Color
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Pair over Bluetooth, enter the backpack PIN, then paste your SDK
            guid and paint his eyes. Stay on his Wi-Fi.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit bg-zinc-900 text-zinc-300">
          {statusLabel}
        </Badge>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {phase === "landing" ? (
        <Card className="bg-zinc-950/80">
          <CardHeader>
            <CardTitle>Find Vector over BLE</CardTitle>
            <CardDescription>
              Chrome or Edge, with Bluetooth on. iPhone Safari cannot do this.
              Pairing alone will not change his eyes — you also need the SDK
              guid from sdk_config.ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ol className="space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-200">
                  1
                </span>
                Put Vector on his charger and wait until his eyes are up.
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-200">
                  2
                </span>
                Double-click the backpack button — the raised key on his LED
                strip. He should show a key icon and a 6-digit PIN.
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-200">
                  3
                </span>
                Click Find Vector, enter the PIN, then paste{" "}
                <code className="text-zinc-100">guid=</code> from{" "}
                <code className="text-zinc-100">~/.anki_vector/sdk_config.ini</code>
                .
              </li>
            </ol>

            {!bleOk && !demo ? (
              <p className="rounded-lg bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
                This browser has no Web Bluetooth. Open the Vercel URL in
                Chrome or Edge on a computer or Android phone.
              </p>
            ) : null}

            <Button
              size="lg"
              className="h-12 w-full bg-teal-400 text-zinc-950 hover:bg-teal-300"
              onClick={() => void findVector()}
              disabled={busy || (!bleOk && !demo)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Bluetooth className="size-4" />
              )}
              Find Vector
            </Button>
            <Button
              variant="ghost"
              className="w-full text-zinc-400"
              onClick={() => {
                setPhase("eyes");
                setPairPhase("paired");
                setLastSent(
                  "Preview only — connect a real Vector to push this color.",
                );
              }}
            >
              Preview the color wheel
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {phase === "pin" ? (
        <Card className="bg-zinc-950/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-teal-300" />
              Enter the backpack PIN
            </CardTitle>
            <CardDescription>
              Type the 6 digits on his face. That code is the pairing secret —
              it is not stored on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              className="h-14 text-center font-mono text-3xl tracking-[0.4em]"
            />
            <Button
              size="lg"
              className="h-12 w-full bg-teal-400 text-zinc-950 hover:bg-teal-300"
              onClick={() => void pairWithPin()}
              disabled={busy || pin.length !== 6}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Pair
            </Button>
            <Button variant="ghost" onClick={disconnect}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {phase === "eyes" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <Card className="bg-zinc-950/80">
            <CardHeader>
              <CardTitle>RGB wheel</CardTitle>
              <CardDescription>
                Requires a valid SDK guid. We send{" "}
                <code className="text-zinc-300">/v1/set_eye_color</code> and
                the nearest permanent preset via{" "}
                <code className="text-zinc-300">update_settings</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ColorWheel
                hue={hs.hue}
                saturation={hs.saturation}
                onChange={queueEyeColor}
                disabled={sending}
              />
              <div className="flex flex-wrap gap-2">
                {EYE_COLOR_ENUM.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:border-teal-300/40 hover:text-white"
                    onClick={() =>
                      queueEyeColor({
                        hue: preset.hue,
                        saturation: preset.saturation,
                      })
                    }
                  >
                    {preset.name}
                  </button>
                ))}
                {VECTOR_PRESETS.filter(
                  (p) => !EYE_COLOR_ENUM.some((e) => e.name === p.name),
                ).map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:border-teal-300/40 hover:text-white"
                    onClick={() =>
                      queueEyeColor({
                        hue: preset.hue,
                        saturation: preset.saturation,
                      })
                    }
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <p className="font-mono text-xs text-zinc-500">
                hue {hs.hue.toFixed(2)} · sat {hs.saturation.toFixed(2)}
                {sending ? " · sending…" : ""}
              </p>
              {lastSent ? (
                <p className="text-sm text-teal-200/90">{lastSent}</p>
              ) : null}
              <Button
                size="lg"
                className="h-11 w-full bg-teal-400 text-zinc-950 hover:bg-teal-300"
                disabled={sending || demo}
                onClick={() => void pushEyeColor(hs)}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                Apply color to Vector
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="bg-zinc-950/80">
              <CardHeader>
                <CardTitle>{info?.name ?? "Vector"}</CardTitle>
                <CardDescription>
                  PIN pairing opens BLE. The SDK guid unlocks eye color on the
                  robot.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <VectorFace
                  hue={hs.hue}
                  saturation={hs.saturation}
                  paired
                />
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="Wi-Fi" value={info?.wifiSsid ?? "—"} icon />
                  <Info label="IP" value={info?.ip ?? "—"} />
                  <Info label="Serial" value={info?.esn ?? "—"} />
                  <Info label="Build" value={info?.build ?? "—"} />
                </dl>
                {info && !info.wifiConnected ? (
                  <p className="text-sm text-amber-200">
                    He is paired over BLE but not on Wi-Fi. Put him on the same
                    network as this device, then try again.
                  </p>
                ) : null}
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </CardContent>
            </Card>

            <Card className="border-teal-500/20 bg-zinc-950/80">
              <CardHeader>
                <CardTitle>SDK guid (required)</CardTitle>
                <CardDescription>
                  From{" "}
                  <code className="text-zinc-300">
                    ~/.anki_vector/sdk_config.ini
                  </code>
                  , the <code className="text-zinc-300">guid=</code> line.
                  WirePod users: use the client token from your WirePod SDK
                  setup. Without this, Vector ignores eye-color commands.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Input
                  value={guid}
                  onChange={(event) => setGuid(event.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="font-mono"
                />
                <Button
                  variant="secondary"
                  disabled={sending || !guid.trim() || demo}
                  onClick={() => {
                    storeSdkGuid(guid);
                    void pushEyeColor(hs, guid);
                  }}
                >
                  Save guid and Apply color
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Info({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: boolean;
}) {
  return (
    <div className="rounded-lg bg-zinc-900/80 px-3 py-2">
      <dt className="flex items-center gap-1 text-[11px] tracking-wide text-zinc-500 uppercase">
        {icon ? <Wifi className="size-3" /> : null}
        {label}
      </dt>
      <dd className="truncate text-zinc-200">{value}</dd>
    </div>
  );
}
