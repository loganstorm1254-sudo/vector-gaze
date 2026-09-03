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
import { type Hs } from "@/lib/vector/color";
import {
  bluetoothSupported,
  EYE_COLOR_ENUM,
  getStoredSdkGuid,
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
          looksLikeEscapePod: false,
        }
      : null,
  );
  const [hs, setHs] = useState<Hs>({ hue: 0.42, saturation: 1 });
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [bleOk, setBleOk] = useState(false);
  const [guidInput, setGuidInput] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [showGuidHelp, setShowGuidHelp] = useState(false);
  const sendTimer = useRef<number | null>(null);

  useEffect(() => {
    setBleOk(bluetoothSupported());
    setGuidInput(getStoredSdkGuid());
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
        return "Authorizing";
      case "paired":
        return "Ready";
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
      await session.refreshInfo();
      await session.prepareSdkGuid();
      setInfo(session.info);
      setGuidInput(getStoredSdkGuid() || guidInput);
      setPhase("eyes");
      setLastSent("Paired. Try the wheel — if Vector rejects the token, use the auth options below.");
    } catch (err) {
      setPairPhase("idle");
      setError(err instanceof Error ? err.message : "Could not find Vector.");
    } finally {
      setBusy(false);
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
      setGuidInput(getStoredSdkGuid() || guidInput);
      setPhase("eyes");
      setLastSent(
        "PIN accepted. Eye color needs an SDK token — try the wheel, or authorize below if it fails.",
      );
      if (session.lastAuthError) {
        setError(session.lastAuthError);
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
    if (sendTimer.current) window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => {
      void pushEyeColor(next);
    }, 280);
  }

  async function pushEyeColor(next: Hs) {
    const session = sessionRef.current;
    if (!session) return;
    setSending(true);
    setLastSent("Sending to Vector…");
    try {
      await session.setEyeColor(next.hue, next.saturation);
      setLastSent("Eye color applied.");
      setError(null);
      setShowGuidHelp(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not set eye color.";
      setError(message);
      setLastSent(null);
      setShowGuidHelp(true);
    } finally {
      setSending(false);
    }
  }

  async function authorizeEscapePod() {
    const session = sessionRef.current;
    if (!session) return;
    setAuthBusy(true);
    setError(null);
    try {
      const result = await session.authorizeWithEscapePodCloud();
      if (!result.ok) {
        setError(result.detail);
        setShowGuidHelp(true);
        return;
      }
      setLastSent("Escape Pod cloud authorized. Drag the wheel.");
      setShowGuidHelp(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Escape Pod auth failed.");
      setShowGuidHelp(true);
    } finally {
      setAuthBusy(false);
    }
  }

  function saveManualGuid() {
    const session = sessionRef.current;
    if (!session) {
      setError("Pair with Vector first, then paste the guid.");
      return;
    }
    const result = session.useManualGuid(guidInput);
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    setError(null);
    setLastSent("SDK guid saved. Try the wheel.");
    setShowGuidHelp(false);
  }

  function disconnect() {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setPhase("landing");
    setPairPhase("idle");
    setPin("");
    setLastSent(null);
    setError(null);
    setShowGuidHelp(false);
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
            Double-click his backpack, enter the PIN, then paint his eyes. Works
            with unlocked CFW — no Wire-Pod required if you already have an SDK
            guid.
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
              Chrome or Edge on a computer or Android. The PIN unlocks an
              encrypted BLE link. Eye-color commands still need an SDK token —
              unlocked CFW does not skip that.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ol className="space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-200">
                  1
                </span>
                Put Vector on his charger until his eyes are up.
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-200">
                  2
                </span>
                Double-click the backpack button so the key icon and 6-digit PIN
                show.
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-200">
                  3
                </span>
                Find Vector, type that PIN, then use the wheel.
              </li>
            </ol>

            {!bleOk && !demo ? (
              <p className="rounded-lg bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
                This browser has no Web Bluetooth. Open the site in Chrome or
                Edge.
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
              Enter the PIN on his face
            </CardTitle>
            <CardDescription>
              This unlocks BLE. It does not talk to Wire-Pod.
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
                Writes permanent custom eye color over the BLE SDK proxy.
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
                Apply color
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="bg-zinc-950/80">
              <CardHeader>
                <CardTitle>{info?.name ?? "Vector"}</CardTitle>
                <CardDescription>
                  Stay on the same Wi-Fi. Color rides the BLE session after the
                  PIN.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <VectorFace hue={hs.hue} saturation={hs.saturation} paired />
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="Wi-Fi" value={info?.wifiSsid ?? "—"} icon />
                  <Info label="IP" value={info?.ip ?? "—"} />
                  <Info label="Serial" value={info?.esn ?? "—"} />
                  <Info label="Build" value={info?.build ?? "—"} />
                </dl>
                {info?.looksLikeEscapePod ? (
                  <p className="text-sm text-amber-200">
                    Build looks Escape Pod style (`ep`). Minting a new token
                    needs escapepod.local on your LAN — not Anki cloud.
                  </p>
                ) : null}
                {info && !info.wifiConnected ? (
                  <p className="text-sm text-amber-200">
                    Paired over BLE but not on Wi-Fi. Connect him to your
                    network, then try again.
                  </p>
                ) : null}
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-zinc-950/80">
              <CardHeader>
                <CardTitle>SDK token</CardTitle>
                <CardDescription>
                  Unlocked CFW still needs a client guid for eye color. Anki
                  cloud is dead, so PIN alone cannot mint one. Skip Wire-Pod if
                  you already have a guid.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {(showGuidHelp || error) && !demo ? (
                  <p className="text-sm text-zinc-400">
                    Prefer a guid from{" "}
                    <code className="text-zinc-200">~/.anki_vector/sdk_config.ini</code>{" "}
                    (the <code className="text-zinc-200">guid=</code> line). Only
                    use Escape Pod cloud if that server is actually running on
                    your network.
                  </p>
                ) : null}

                <div className="flex flex-col gap-2">
                  <label className="text-xs tracking-wide text-zinc-500 uppercase">
                    Existing SDK guid
                  </label>
                  <Input
                    value={guidInput}
                    onChange={(event) => setGuidInput(event.target.value)}
                    placeholder="paste guid= from sdk_config.ini"
                    className="font-mono text-sm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button
                    variant="secondary"
                    disabled={demo || !guidInput.trim()}
                    onClick={saveManualGuid}
                  >
                    Use this guid
                  </Button>
                </div>

                <div className="border-t border-white/5 pt-4">
                  <p className="mb-3 text-xs text-zinc-500">
                    Optional — only if Escape Pod or Wire-Pod is running and
                    Vector can resolve escapepod.local.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={demo || authBusy}
                    onClick={() => void authorizeEscapePod()}
                  >
                    {authBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Authorize with Escape Pod cloud
                  </Button>
                </div>
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
