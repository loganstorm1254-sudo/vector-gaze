export type Rgb = { r: number; g: number; b: number };
export type Hs = { hue: number; saturation: number };

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function rgbToHs({ r, g, b }: Rgb): Hs {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
        break;
    }
  }
  const s = max === 0 ? 0 : d / max;
  return { hue: clamp01(h), saturation: clamp01(s) };
}

export function hsToRgb(hue: number, saturation: number, value = 1): Rgb {
  const h = ((hue % 1) + 1) % 1;
  const s = clamp01(saturation);
  const v = clamp01(value);
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export function rgbToCss({ r, g, b }: Rgb) {
  return `rgb(${r}, ${g}, ${b})`;
}

export function rgbToHex({ r, g, b }: Rgb) {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export const VECTOR_PRESETS: { name: string; hue: number; saturation: number }[] =
  [
    { name: "Teal", hue: 0.42, saturation: 1 },
    { name: "Orange", hue: 0.05, saturation: 0.95 },
    { name: "Yellow", hue: 0.11, saturation: 1 },
    { name: "Lime", hue: 0.21, saturation: 1 },
    { name: "Sapphire", hue: 0.57, saturation: 1 },
    { name: "Purple", hue: 0.83, saturation: 0.76 },
    { name: "Red", hue: 0, saturation: 1 },
    { name: "White", hue: 0, saturation: 0 },
  ];
