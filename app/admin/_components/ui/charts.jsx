/**
 * Lightweight, dependency-free charts for the dashboard.
 *
 * Series colours are validated for the dark surface (OKLCH band, CVD ΔE ≥ 8
 * on adjacent pairs): recognized/not recognized/failed = aqua/blue/orange.
 * Every chart ships a legend (≥ 2 series), a hover tooltip per mark and an
 * sr-only data table (the accessible equivalent for keyboard and
 * screen-reader users).
 */

export const SERIES_COLORS = {
  recognized: "#199e70",
  not_recognized: "#3987e5",
  failed: "#d95926",
  analyses: "#3987e5",
};

function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4) * magnitude;
  return Math.ceil(value / step) * step;
}

export function Legend({ series }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-app-secondary">
      {series.map((entry) => (
        <li key={entry.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES_COLORS[entry.key] }} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ title, series, datum, className = "" }) {
  return (
    <div
      role="presentation"
      className={`pointer-events-none absolute z-10 hidden w-max min-w-32 rounded-lg border border-app-border-strong bg-app-raised px-3 py-2 text-xs shadow-xl shadow-black/40 group-hover:block ${className}`}
    >
      <p className="font-medium text-app-text">{title}</p>
      {series.map((entry) => (
        <p key={entry.key} className="mt-1 flex items-center justify-between gap-4 text-app-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: SERIES_COLORS[entry.key] }} aria-hidden="true" />
            {entry.label}
          </span>
          <span className="tabular-nums text-app-text">{datum[entry.key]}</span>
        </p>
      ))}
    </div>
  );
}

function DataTableFallback({ caption, series, data, labelKey, formatLabel, labelHeader = "Periodo" }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHeader}</th>
          {series.map((entry) => (
            <th key={entry.key} scope="col">
              {entry.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum[labelKey]}>
            <th scope="row">{formatLabel(datum[labelKey])}</th>
            {series.map((entry) => (
              <td key={entry.key}>{datum[entry.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Vertical stacked columns (e.g. analyses per hour).
 * @param {{ data: Record<string, any>[], series: { key: string, label: string }[], labelKey: string,
 *   formatLabel: (value: any) => string, caption: string, height?: number }} props
 */
export function StackedColumnChart({ data, series, labelKey, formatLabel, caption, height = 180 }) {
  // A single series needs no legend: the card title already names it.
  const showLegend = series.length > 1;
  const max = niceMax(Math.max(0, ...data.map((datum) => series.reduce((sum, entry) => sum + datum[entry.key], 0))));
  const ticks = [max, max / 2, 0];

  return (
    <figure>
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-app-muted" style={{ height }} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {tick}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0 flex flex-col justify-between" style={{ height }} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className="h-px bg-app-border" />
            ))}
          </div>
          <div className="relative flex items-end justify-between gap-1" style={{ height }} aria-hidden="true">
            {data.map((datum, index) => {
              const total = series.reduce((sum, entry) => sum + datum[entry.key], 0);
              const alignRight = index > data.length / 2;
              return (
                <div key={datum[labelKey]} className="group relative flex h-full flex-1 items-end justify-center">
                  <div className="flex w-full max-w-6 flex-col-reverse gap-[2px]" style={{ height: `${(total / max) * 100}%` }}>
                    {series.map((entry) =>
                      datum[entry.key] > 0 ? (
                        <span
                          key={entry.key}
                          className="block w-full last:rounded-t-[4px] group-hover:brightness-125"
                          style={{ flexGrow: datum[entry.key], background: SERIES_COLORS[entry.key], minHeight: 2 }}
                        />
                      ) : null,
                    )}
                  </div>
                  <Tooltip
                    title={formatLabel(datum[labelKey])}
                    series={series}
                    datum={datum}
                    className={`bottom-[calc(100%+6px)] ${alignRight ? "right-0" : "left-0"}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between gap-1 text-[10px] tabular-nums text-app-muted" aria-hidden="true">
            {data.map((datum, index) => (
              <span key={datum[labelKey]} className={`flex-1 text-center ${index % 2 ? "invisible sm:visible" : ""}`}>
                {formatLabel(datum[labelKey])}
              </span>
            ))}
          </div>
        </div>
      </div>
      {showLegend ? (
        <figcaption className="mt-4">
          <Legend series={series} />
        </figcaption>
      ) : null}
      <DataTableFallback caption={caption} series={series} data={data} labelKey={labelKey} formatLabel={formatLabel} />
    </figure>
  );
}

/**
 * Horizontal stacked bars, one row per category (e.g. queue depth per model).
 * Totals are direct-labelled at the bar end.
 */
export function StackedBarList({ data, series, labelKey, formatLabel, caption, labelHeader = "Categoria" }) {
  const max = Math.max(1, ...data.map((datum) => series.reduce((sum, entry) => sum + datum[entry.key], 0)));
  return (
    <figure>
      <ul className="space-y-3" aria-hidden="true">
        {data.map((datum) => {
          const total = series.reduce((sum, entry) => sum + datum[entry.key], 0);
          return (
            <li key={datum[labelKey]} className="group relative grid grid-cols-[88px_1fr] items-center gap-3 sm:grid-cols-[110px_1fr]">
              <span className="truncate text-xs text-app-secondary">{formatLabel(datum[labelKey])}</span>
              <div className="flex h-5 items-center gap-2">
                <div className="flex h-3.5 gap-[2px]" style={{ width: `${(total / max) * 85}%` }}>
                  {series.map((entry) =>
                    datum[entry.key] > 0 ? (
                      <span
                        key={entry.key}
                        className="block h-full last:rounded-r-[4px] group-hover:brightness-125"
                        style={{ flexGrow: datum[entry.key], background: SERIES_COLORS[entry.key], minWidth: 2 }}
                      />
                    ) : null,
                  )}
                </div>
                <span className="text-xs tabular-nums text-app-muted">{total}</span>
              </div>
              <Tooltip title={formatLabel(datum[labelKey])} series={series} datum={datum} className="bottom-[calc(100%+4px)] left-[100px]" />
            </li>
          );
        })}
      </ul>
      {series.length > 1 ? (
        <figcaption className="mt-4">
          <Legend series={series} />
        </figcaption>
      ) : null}
      <DataTableFallback caption={caption} series={series} data={data} labelKey={labelKey} formatLabel={formatLabel} labelHeader={labelHeader} />
    </figure>
  );
}
