"use client";

import { useCallback, useEffect, useRef } from "react";

import { hsToRgb, rgbToCss, type Hs } from "@/lib/vector/color";

type ColorWheelProps = {
  hue: number;
  saturation: number;
  onChange: (next: Hs) => void;
  disabled?: boolean;
};

const SIZE = 280;
const PADDING = 18;

function eventToHs(
  event: PointerEvent | React.PointerEvent,
  el: HTMLCanvasElement,
): Hs {
  const rect = el.getBoundingClientRect();
  const scale = SIZE / rect.width;
  const x = (event.clientX - rect.left) * scale - SIZE / 2;
  const y = (event.clientY - rect.top) * scale - SIZE / 2;
  const radius = SIZE / 2 - PADDING;
  const dist = Math.sqrt(x * x + y * y);
  const sat = Math.min(1, dist / radius);
  let hue = Math.atan2(y, x) / (Math.PI * 2);
  if (hue < 0) hue += 1;
  return { hue, saturation: sat };
}

function drawWheel(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const radius = SIZE / 2 - PADDING;
  const image = ctx.createImageData(SIZE, SIZE);
  const data = image.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * SIZE + x) * 4;
      if (dist > radius) {
        data[i + 3] = 0;
        continue;
      }
      let hue = Math.atan2(dy, dx) / (Math.PI * 2);
      if (hue < 0) hue += 1;
      const sat = dist / radius;
      const { r, g, b } = hsToRgb(hue, sat, 1);
      const edge = Math.max(0, Math.min(1, radius - dist));
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(255 * Math.min(1, edge * 2));
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function ColorWheel({
  hue,
  saturation,
  onChange,
  disabled,
}: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawWheel(ctx);
  }, []);

  const pick = useCallback(
    (event: PointerEvent | React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || disabled) return;
      onChange(eventToHs(event, canvas));
    },
    [disabled, onChange],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      pick(event);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [pick]);

  const radius = SIZE / 2 - PADDING;
  const angle = hue * Math.PI * 2;
  const x = SIZE / 2 + Math.cos(angle) * saturation * radius;
  const y = SIZE / 2 + Math.sin(angle) * saturation * radius;
  const css = rgbToCss(hsToRgb(hue, saturation));

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[280px]">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="h-full w-full touch-none select-none rounded-full"
        onPointerDown={(event) => {
          if (disabled) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
      />
      <div
        className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        style={{
          left: `${(x / SIZE) * 100}%`,
          top: `${(y / SIZE) * 100}%`,
          background: css,
        }}
      />
    </div>
  );
}
