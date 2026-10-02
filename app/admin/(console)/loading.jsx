import { Skeleton } from "../_components/ui/States";

export default function ConsoleLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-80 rounded-2xl" />
    </div>
  );
}
