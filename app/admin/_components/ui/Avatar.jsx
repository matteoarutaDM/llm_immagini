import { initials } from "../../_lib/format";

const SIZES = { sm: "h-8 w-8 text-[11px]", md: "h-10 w-10 text-xs", lg: "h-14 w-14 text-base" };

export function Avatar({ name, size = "sm" }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-app-accent-soft font-semibold text-app-accent ring-1 ring-inset ring-app-accent/20 ${SIZES[size]}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
