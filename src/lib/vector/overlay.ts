/** WireOS Face menu overlays — matches kProcFace_FlavorOfGay + LOOK_LoadFaceOverlay. */

export const FACE_DISPLAY_WIDTH = 184;
export const FACE_DISPLAY_HEIGHT = 96;

export const FACE_OVERLAYS = [
  {
    id: "off",
    name: "Off",
    flavor: null,
    thumb: null,
  },
  {
    id: "lesbian",
    name: "Lesbian",
    flavor: 0,
    thumb: "/face-overlays/lesbian.jpg",
  },
  {
    id: "gay",
    name: "Gay",
    flavor: 1,
    thumb: "/face-overlays/gay.jpg",
  },
  {
    id: "bi",
    name: "Bi",
    flavor: 2,
    thumb: "/face-overlays/bi.jpg",
  },
  {
    id: "trans",
    name: "Trans",
    flavor: 3,
    thumb: "/face-overlays/trans.jpg",
  },
  {
    id: "pan",
    name: "Pan",
    flavor: 4,
    thumb: "/face-overlays/pan.jpg",
  },
  {
    id: "frog",
    name: "Frog",
    flavor: 5,
    thumb: "/face-overlays/frog.jpg",
  },
  {
    id: "all",
    name: "Pride",
    flavor: 6,
    thumb: "/face-overlays/all.jpg",
  },
  {
    id: "galaxy",
    name: "Galaxy",
    flavor: 7,
    thumb: "/face-overlays/galaxy.jpg",
  },
  {
    id: "custom",
    name: "Custom",
    flavor: 8,
    thumb: null,
  },
] as const;

export type FaceOverlayId = (typeof FACE_OVERLAYS)[number]["id"];
export type FaceOverlayFlavor = Exclude<
  (typeof FACE_OVERLAYS)[number]["flavor"],
  null
>;

export type PreparedOverlayJpeg = {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
};

/** Resize any image to Vector’s face LCD size as a JPEG. */
export async function prepareOverlayJpeg(file: Blob): Promise<PreparedOverlayJpeg> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = FACE_DISPLAY_WIDTH;
    canvas.height = FACE_DISPLAY_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare image canvas.");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.max(
      canvas.width / bitmap.width,
      canvas.height / bitmap.height,
    );
    const drawW = bitmap.width * scale;
    const drawH = bitmap.height * scale;
    ctx.drawImage(
      bitmap,
      (canvas.width - drawW) / 2,
      (canvas.height - drawH) / 2,
      drawW,
      drawH,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("JPEG encode failed."))),
        "image/jpeg",
        0.92,
      );
    });

    return {
      blob,
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      width: FACE_DISPLAY_WIDTH,
      height: FACE_DISPLAY_HEIGHT,
    };
  } finally {
    bitmap.close();
  }
}

export function downloadOverlayJpeg(blob: Blob, filename = "customFaceOverlay.jpg") {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
