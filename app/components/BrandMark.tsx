import { CpuChipIcon } from "@heroicons/react/24/outline";

const SIZES = {
  sm: { box: "h-8 w-8", icon: "h-4 w-4", radius: "rounded-lg" },
  md: { box: "h-10 w-10", icon: "h-5 w-5", radius: "rounded-xl" },
  lg: { box: "h-12 w-12", icon: "h-6 w-6", radius: "rounded-xl" },
} as const;

export function BrandMark({ size = "md" }: { size?: keyof typeof SIZES }) {
  const { box, icon, radius } = SIZES[size];
  return (
    <div
      className={`grid ${box} shrink-0 place-items-center ${radius} bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-950/25 ring-1 ring-inset ring-white/15`}
      aria-hidden="true"
    >
      <CpuChipIcon className={icon} />
    </div>
  );
}
