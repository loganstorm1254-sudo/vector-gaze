"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bluetooth, ImageIcon, KeyRound, Loader2, Volume2, Wifi } from "lucide-react";

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
  downloadOverlayJpeg,
  FACE_OVERLAYS,
  prepareOverlayJpeg,
  type FaceOverlayId,
  type PreparedOverlayJpeg,
} from "@/lib/vector/overlay";
import {
  bluetoothSupported,
  ensureLocalNetworkAccess,
  EYE_COLOR_ENUM,
  VOLUME_LEVELS,
  VectorSession,
  type PairPhase,
  type VectorInfo,
  type VolumeLevel,
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
  const [volume, setVolume] = useState<VolumeLevel>(3);
  const [overlayId, setOverlayId] = useState<FaceOverlayId>("off");
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [sshPassword, setSshPassword] = useState("");
  const [customPreview, setCustomPreview] = useState<PreparedOverlayJpeg | null>(
    null,
  );
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [bleOk, setBleOk] = useState(false);
  const sendTimer = useRef<number | null>(null);
  const volumeTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setBleOk(bluetoothSupported());
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
      setInfo(session.info);
      setPhase("eyes");
      setLastSent("Paired. Drag the wheel.");
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
      // Trigger Chrome Local Network Access prompt early (needed on Vercel HTTPS).
      void ensureLocalNetworkAccess();
      if (session.info?.ip) {
        void fetch(`http://${session.info.ip}:8889/consolevarget?key=kProcFace_Hue`, {
          mode: "no-cors",
          cache: "no-store",
          ...({ targetAddressSpace: "local" } as RequestInit),
        }).catch(() => undefined);
      }
      setPhase("eyes");
      setLastSent(
        session.info?.ip
          ? `PIN accepted · ${session.info.ip}. If Chrome asks for local network access, click Allow.`
          : "PIN accepted. Connect Vector to Wi-Fi so eye color can reach him.",
      );
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
      const result = await session.setEyeColor(next.hue, next.saturation);
      setLastSent(
        result.via === "console"
          ? "Eye color sent over his local console — no servers."
          : "Eye color sent.",
      );
      setError(null);
      setInfo(session.info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set eye color.");
      setLastSent(null);
    } finally {
      setSending(false);
    }
  }

  function queueVolume(level: VolumeLevel) {
    setVolume(level);
    if (demo) {
      setLastSent("Preview only — connect a real Vector to push volume.");
      return;
    }
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => {
      void pushVolume(level);
    }, 280);
  }

  async function pushVolume(level: VolumeLevel) {
    const session = sessionRef.current;
    if (!session) return;
    setSending(true);
    setLastSent("Setting volume…");
    try {
      await session.setVolume(level);
      const label =
        VOLUME_LEVELS.find((entry) => entry.value === level)?.name ?? String(level);
      setLastSent(`Volume set to ${label} via eng console — no servers.`);
      setError(null);
      setInfo(session.info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set volume.");
      setLastSent(null);
    } finally {
      setSending(false);
    }
  }

  async function pushOverlay(
    id: FaceOverlayId,
    opacity = overlayOpacity,
    prepared: PreparedOverlayJpeg | null = customPreview,
    opts: { replaceCustom?: boolean } = {},
  ) {
    const session = sessionRef.current;
    const entry = FACE_OVERLAYS.find((item) => item.id === id);
    if (!entry) return;

    if (demo) {
      setOverlayId(id);
      setLastSent("Preview only — connect a real Vector to push overlays.");
      return;
    }
    if (!session) return;

    const replaceCustom = opts.replaceCustom ?? id === "custom";

    setSending(true);
    setOverlayId(id);
    setError(null);
    setLastSent(
      id === "custom" && replaceCustom
        ? "Wiping old custom overlay and writing the new image…"
        : id === "custom"
          ? "Loading custom overlay from the robot…"
          : id === "off"
            ? "Turning overlay off…"
            : `Loading ${entry.name} overlay…`,
    );

    try {
      if (id === "custom" && replaceCustom) {
        if (!prepared) {
          throw new Error("Pick a custom image first.");
        }
        try {
          await session.replaceCustomOverlay(
            prepared.blob,
            opacity,
            sshPassword || undefined,
          );
          setLastSent(
            "Old custom wiped — new image written and loaded on his face.",
          );
        } catch (uploadErr) {
          // Stay wiped. Reloading Custom here would bring the OLD file back.
          downloadOverlayJpeg(prepared.blob);
          setOverlayId("off");
          const detail =
            uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          setError(detail);
          setLastSent(
            "Old custom wiped from his face. New JPG downloaded — SCP it to /data/data/customFaceOverlay.jpg, then tap Custom and Apply overlay.",
          );
        }
      } else {
        await session.setEyeOverlay(entry.flavor, opacity);
        setLastSent(
          id === "off"
            ? "Eye overlay off."
            : `${entry.name} overlay loaded via Face console — no servers.`,
        );
      }
      setInfo(session.info);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not set overlay.";
      setError(message);
      setLastSent(null);
    } finally {
      setSending(false);
    }
  }

  async function onPickCustomImage(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const prepared = await prepareOverlayJpeg(file);
      setCustomPreview(prepared);
      setOverlayId("custom");
      if (demo) {
        setLastSent("Preview only — connect a real Vector to push this overlay.");
        return;
      }
      await pushOverlay("custom", overlayOpacity, prepared, {
        replaceCustom: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
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
    setOverlayId("off");
    setCustomPreview(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-teal-300/80 uppercase">
            Anki Vector
          </p>
          <h1 className="font-heading text-3xl text-white sm:text-4xl">
            Eyes, Volume & Overlays
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Works on Vercel. Double-click his backpack, enter the PIN, paint his
            eyes, set volume, and pick a Face overlay. Unlocked CFW — no
            Wire-Pod, no guid paste.
          </p>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">
            build console-only · eyes + volume + overlays · no SDK guid
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
              Chrome or Edge on a computer or Android. Same Wi-Fi as Vector.
              When Chrome asks for local network access, click Allow — that lets
              this HTTPS site talk to him on your LAN.
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
                Find Vector, type that PIN, then set eyes, volume, and overlays.
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
              That’s it. No accounts, no servers, no guid paste.
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
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <Card className="bg-zinc-950/80">
              <CardHeader>
                <CardTitle>RGB wheel</CardTitle>
                <CardDescription>
                  Pushes hue/saturation straight to Vector’s face console on your
                  LAN.
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

            <Card className="bg-zinc-950/80">
              <CardHeader>
                <CardTitle>{info?.name ?? "Vector"}</CardTitle>
                <CardDescription>
                  BLE for pairing, Wi-Fi for console packets. No external
                  servers.
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
                {info && !info.wifiConnected ? (
                  <p className="text-sm text-amber-200">
                    Paired over BLE but not on Wi-Fi. Connect him to your network,
                    then try again.
                  </p>
                ) : null}
                <Button variant="outline" onClick={disconnect}>
                  Disconnect
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-zinc-950/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="size-4 text-teal-300" />
                Speaker volume
              </CardTitle>
              <CardDescription>
                Same eng-console path as eyes: set{" "}
                <code className="text-teal-200/90">MasterVolumeLevel</code>{" "}
                (0–5), then{" "}
                <code className="text-teal-200/90">DebugSetMasterVolume</code>{" "}
                on port 8888.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {VOLUME_LEVELS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    disabled={sending}
                    className={
                      volume === entry.value
                        ? "rounded-full border border-teal-300/50 bg-teal-400/15 px-3 py-1.5 text-xs text-teal-100"
                        : "rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:border-teal-300/40 hover:text-white disabled:opacity-50"
                    }
                    onClick={() => queueVolume(entry.value)}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
              {lastSent ? (
                <p className="text-sm text-teal-200/90">{lastSent}</p>
              ) : null}
              <Button
                size="lg"
                className="h-11 w-full bg-teal-400 text-zinc-950 hover:bg-teal-300 sm:w-auto"
                disabled={sending || demo}
                onClick={() => void pushVolume(volume)}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                Apply volume
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="size-4 text-teal-300" />
                Eye overlays
              </CardTitle>
              <CardDescription>
                Same Face menu as{" "}
                <code className="text-teal-200/90">:8889/consolevars</code> —
                enable{" "}
                <code className="text-teal-200/90">ProcFace_CustomEyes</code>,
                pick a flavor, then{" "}
                <code className="text-teal-200/90">LOOK_LoadFaceOverlay</code>.
                Custom expects{" "}
                <code className="text-teal-200/90">
                  /data/data/customFaceOverlay.jpg
                </code>{" "}
                (184×96).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {FACE_OVERLAYS.map((entry) => {
                  const selected = overlayId === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={sending}
                      onClick={() => {
                        // Always re-pick for Custom so the new image replaces the old one.
                        if (entry.id === "custom") {
                          fileInputRef.current?.click();
                          return;
                        }
                        void pushOverlay(entry.id);
                      }}
                      className={
                        selected
                          ? "overflow-hidden rounded-xl border border-teal-300/50 bg-teal-400/10 text-left disabled:opacity-50"
                          : "overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 text-left hover:border-teal-300/40 disabled:opacity-50"
                      }
                    >
                      <div className="relative aspect-[184/96] bg-zinc-950">
                        {entry.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={entry.thumb}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : entry.id === "custom" && customPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={customPreview.dataUrl}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-[11px] text-zinc-500">
                            {entry.id === "off" ? "None" : "Pick file"}
                          </div>
                        )}
                      </div>
                      <div className="px-2 py-1.5 text-xs text-zinc-200">
                        {entry.name}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex flex-1 flex-col gap-1 text-sm text-zinc-300">
                  <span className="text-xs tracking-wide text-zinc-500 uppercase">
                    Overlay opacity · {overlayOpacity.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={overlayOpacity}
                    disabled={sending || overlayId === "off"}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setOverlayOpacity(next);
                    }}
                    onPointerUp={() => {
                      if (overlayId !== "off" && overlayId !== "custom") {
                        void pushOverlay(overlayId, overlayOpacity);
                      } else if (overlayId === "custom" && customPreview) {
                        void pushOverlay("custom", overlayOpacity, customPreview);
                      }
                    }}
                    className="w-full accent-teal-400"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm text-zinc-300">
                <span className="text-xs tracking-wide text-zinc-500 uppercase">
                  Robot SSH password (for replacing custom JPG)
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="root password — overwrites /data/data/customFaceOverlay.jpg"
                  value={sshPassword}
                  onChange={(event) => setSshPassword(event.target.value)}
                  className="max-w-md bg-zinc-900"
                />
                <span className="text-xs text-zinc-500">
                  Lets Custom wipe the old file and write yours. Use with local{" "}
                  <code className="text-zinc-400">npm run dev</code> on the same
                  Wi-Fi. Kept only in this page session.
                </span>
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void onPickCustomImage(file);
                  event.target.value = "";
                }}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose custom image
                </Button>
                <Button
                  type="button"
                  className="bg-teal-400 text-zinc-950 hover:bg-teal-300"
                  disabled={sending || demo || overlayId === "off"}
                  onClick={() =>
                    void pushOverlay(overlayId, overlayOpacity, customPreview, {
                      // Apply reloads from robot disk (after SCP) without requiring rewrite.
                      replaceCustom: false,
                    })
                  }
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Apply overlay
                </Button>
                {customPreview ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={sending}
                    onClick={() => downloadOverlayJpeg(customPreview.blob)}
                  >
                    Download 184×96 JPG
                  </Button>
                ) : null}
              </div>

              {lastSent ? (
                <p className="text-sm text-teal-200/90">{lastSent}</p>
              ) : null}
            </CardContent>
          </Card>
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
