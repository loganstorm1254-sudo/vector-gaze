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
  const [needsGuid, setNeedsGuid] = useState(false);
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
        setError("Vector dropped the Bluetooth link. Double-click his backpack and pair again.");
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
    if (sendTimer.current) window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => {
      void pushEyeColor(next);
    }, 180);
  }

  async function pushEyeColor(next: Hs, guidOverride?: string) {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (guidOverride) storeSdkGuid(guidOverride);
      await session.setEyeColor(next.hue, next.saturation, guidOverride ?? guid);
      setLastSent("Vector took the new eye color.");
      setNeedsGuid(false);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not set eye color.";
      setError(message);
      if (message.includes("guid")) setNeedsGuid(true);
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
            Pair over Bluetooth the same way the companion app does: double-click
            the backpack button, read the key-screen PIN, then paint his eyes.
            Stay on his Wi-Fi.
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
              The site is static, so it works on Vercel — pairing happens in
              your browser, next to him.
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
                Click Find Vector and pick the device whose name matches that
                PIN (or <span className="text-zinc-100">Vector XXXX</span>).
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
                Hue and saturation map to Vector’s{" "}
                <code className="text-zinc-300">set_eye_color</code> values.
                Drag the wheel; he updates after a short pause.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ColorWheel
                hue={hs.hue}
                saturation={hs.saturation}
                onChange={queueEyeColor}
              />
              <div className="flex flex-wrap gap-2">
                {VECTOR_PRESETS.map((preset) => (
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
              </p>
              {lastSent ? (
                <p className="text-sm text-teal-200/90">{lastSent}</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="bg-zinc-950/80">
              <CardHeader>
                <CardTitle>{info?.name ?? "Vector"}</CardTitle>
                <CardDescription>
                  Same network as this browser. Eye color rides the BLE SDK
                  proxy after a successful PIN.
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
                    network as this device, then try the wheel again.
                  </p>
                ) : null}
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </CardContent>
            </Card>

            {needsGuid || guid ? (
              <Card className="bg-zinc-950/80">
                <CardHeader>
                  <CardTitle>SDK guid</CardTitle>
                  <CardDescription>
                    Some firmware only accepts{" "}
                    <code className="text-zinc-300">/v1/set_eye_color</code>{" "}
                    with the guid from{" "}
                    <code className="text-zinc-300">sdk_config.ini</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Input
                    value={guid}
                    onChange={(event) => setGuid(event.target.value)}
                    placeholder="client token guid"
                    className="font-mono"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      storeSdkGuid(guid);
                      void pushEyeColor(hs, guid);
                    }}
                  >
                    Save and send color
                  </Button>
                </CardContent>
              </Card>
            ) : null}
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
