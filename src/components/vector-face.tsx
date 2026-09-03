import { hsToRgb, rgbToCss } from "@/lib/vector/color";

type VectorFaceProps = {
  hue: number;
  saturation: number;
  paired?: boolean;
};

export function VectorFace({ hue, saturation, paired }: VectorFaceProps) {
  const color = rgbToCss(hsToRgb(hue, saturation, 1));
  const dim = paired ? color : "rgb(56, 189, 168)";

  return (
    <div className="relative mx-auto flex h-28 w-44 items-center justify-center rounded-[2rem] bg-zinc-950 ring-1 ring-white/10">
      <div className="absolute inset-x-6 top-3 h-px bg-white/10" />
      <div className="flex items-center gap-8">
        <Eye color={dim} />
        <Eye color={dim} />
      </div>
    </div>
  );
}

function Eye({ color }: { color: string }) {
  return (
    <div className="relative">
      <div
        className="size-10 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 18px ${color}`,
        }}
      />
      <div className="absolute top-1.5 left-2 size-2 rounded-full bg-white/80" />
    </div>
  );
}
