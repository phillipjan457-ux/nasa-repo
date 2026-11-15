import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ValueTable } from "./AnalysisUI";
import { useMonths } from "@/lib/firewatch/i18n";

type Month = {
  month: number;
  median: number | null;
  min: number | null;
  max: number | null;
  years_with_records: number;
  counts: Record<string, number | null>;
};
type Season = {
  available: boolean;
  months: Month[];
  typical_peak_months: number[];
  comparable_months: number;
  reference_years: number[];
  method: string;
  limitations: string;
  years: {
    year: number;
    months_with_records: number;
    peak_months: number[];
    peak_activity: number | null;
  }[];
};
const API = import.meta.env["VITE_ARCHIVE_API"] ?? "";
const format = (n: number | null | undefined) => (n == null ? "Unavailable" : n.toLocaleString());

export function CriticalPeriods({
  region,
  daynight,
  detectionType,
  technical,
}: {
  region: string;
  daynight: string;
  detectionType: "vegetation" | "all";
  technical: boolean;
}) {
  const months = useMonths("long");
  const query = new URLSearchParams({ detection_type: detectionType });
  if (region) query.set("region", region);
  if (daynight) query.set("daynight", daynight);
  const key = query.toString();
  const [state, setState] = useState<{ key: string; data?: Season; error?: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setState(null);
    fetch(API + "/api/archive/critical-periods?" + key, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("Seasonal summary is unavailable.");
        return response.json();
      })
      .then((data) => {
        if (!abort.signal.aborted) setState({ key, data });
      })
      .catch((error) => {
        if (!abort.signal.aborted) setState({ key, error: String(error.message ?? error) });
      });
    return () => abort.abort();
  }, [key]);
  const result = state?.key === key ? state : null;
  const data = result?.data;
  const names = (values: number[]) => values.map((month) => months[month - 1]).join(" / ");
  return (
    <section
      className="panel p-5 relative"
      aria-labelledby="critical-period-title"
      aria-busy={!result}
    >
      <h2 id="critical-period-title">Historical burning periods</h2>
      <p className="chart-caption">
        Reference: all months of 2022–2025 · {region || "Indonesia"} ·{" "}
        {daynight === "D" ? "Day" : daynight === "N" ? "Night" : "Day + night"} ·{" "}
        {detectionType === "vegetation" ? "Presumed vegetation fires" : "All thermal detections"}.
      </p>
      <p className="chart-caption">
        Dashboard year, month and date-range selections do not shorten this seasonal reference.
        These are recorded activity patterns, not danger levels or predictions.
      </p>
      {!result && (
        <div className="loading-notice" role="status">
          <span className="loading-spinner" />
          Loading seasonal reference.
        </div>
      )}
      {result?.error && <div role="alert">{result.error}</div>}
      {data && !data.available && (
        <p role="status">
          No retained observations for this reference scope. Burning activity and observation
          coverage are unknown.
        </p>
      )}
      {data?.available && (
        <>
          <p className="my-4">
            <strong>
              Typical peak:{" "}
              {data.typical_peak_months.length
                ? names(data.typical_peak_months)
                : "Not established"}
              .
            </strong>{" "}
            Typical means the median count for that month across all four years.{" "}
            {data.comparable_months}/12 months have all four values.
          </p>
          <div className="chart-frame" aria-label="Typical monthly grouped activity">
            <ResponsiveContainer>
              <BarChart
                data={data.months.map((r) => ({ ...r, label: months[r.month - 1] }))}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                  }}
                />
                <Bar
                  name="Four-year median activity units"
                  maxBarSize={48}
                  dataKey="median"
                  fill="var(--primary)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ValueTable
            caption="Seasonal reference: median and year-to-year variation"
            headers={[
              "Month",
              "Median activity units",
              "Observed minimum",
              "Observed maximum",
              "Years with records",
              ...(technical ? data.reference_years.map(String) : []),
            ]}
            rows={data.months.map((row) => [
              months[row.month - 1],
              format(row.median),
              format(row.min),
              format(row.max),
              `${row.years_with_records}/4`,
              ...(technical
                ? data.reference_years.map((year) => format(row.counts[String(year)]))
                : []),
            ])}
          />
          <p className="chart-caption">
            Minimum–maximum shows variation between recorded yearly values, not forecast
            uncertainty. Missing values remain unavailable; they are never filled with zero.
          </p>
          <h3 className="mt-5">Busiest recorded months by year</h3>
          <div className="metric-grid mt-3">
            {data.years.map((year) => (
              <div className="metric" key={year.year}>
                <strong>
                  {year.year}:{" "}
                  {year.peak_months.length
                    ? names(year.peak_months)
                    : "No positive peak established"}
                </strong>
                <p>{format(year.peak_activity)} activity units in each peak month</p>
                <small>{year.months_with_records}/12 months with records; ties included.</small>
              </div>
            ))}
          </div>
          <details className="chart-method">
            <summary>Method and limitations</summary>
            <p>{data.method}</p>
            <p>{data.limitations}</p>
          </details>
        </>
      )}
    </section>
  );
}
