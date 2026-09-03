"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const VectorApp = dynamic(
  () =>
    import("@/components/vector-app").then((mod) => ({ default: mod.VectorApp })),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-3xl px-4 py-16 text-sm text-zinc-500">
        Loading Vector…
      </div>
    ),
  },
);

function LoaderInner() {
  const params = useSearchParams();
  return <VectorApp demo={params.get("demo") === "1"} />;
}

export function VectorAppLoader() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-4 py-16 text-sm text-zinc-500">
          Loading Vector…
        </div>
      }
    >
      <LoaderInner />
    </Suspense>
  );
}
