import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CriticalPeriods } from "./CriticalPeriods";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: () => <div>Seasonal chart</div>,
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
const props = {
  region: "Central Kalimantan",
  daynight: "D",
  detectionType: "vegetation" as const,
  technical: false,
};
const result = {
  available: true,
  months: [
    {
      month: 9,
      median: 10,
      min: 5,
      max: 30,
      years_with_records: 4,
      counts: { "2022": 5, "2023": 30, "2024": 10, "2025": 10 },
    },
  ],
  typical_peak_months: [9],
  comparable_months: 1,
  reference_years: [2022, 2023, 2024, 2025],
  method: "Median across four years",
  limitations: "Historical only",
  years: [{ year: 2023, months_with_records: 12, peak_months: [10], peak_activity: 30 }],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows reference scope, median, variation and recorded annual peaks", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => result })),
  );
  const { rerender } = render(<CriticalPeriods {...props} />);
  await screen.findByText("Typical peak: September.");
  expect(screen.getByText("2023: October")).toBeTruthy();
  expect(
    screen.getByText(/Dashboard year, month and date-range selections do not shorten/),
  ).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("detection_type=vegetation&region=Central+Kalimantan&daynight=D"),
    expect.anything(),
  );
  expect(screen.queryByRole("columnheader", { name: "2025" })).toBeNull();
  rerender(<CriticalPeriods {...props} technical />);
  fireEvent.click(screen.getByLabelText(/^View chart values:/));
  expect(screen.getByRole("columnheader", { name: "2025" })).toBeTruthy();
});
it("aborts outdated scope requests and shows no invented baseline for empty data", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      signals.push(options.signal);
      return { ok: true, json: async () => ({ ...result, available: false }) };
    }),
  );
  const { rerender } = render(<CriticalPeriods {...props} />);
  await screen.findByText(/No retained observations/);
  rerender(<CriticalPeriods {...props} region="Bali" />);
  await waitFor(() => expect(signals).toHaveLength(2));
  expect(signals[0]!.aborted).toBe(true);
  expect(screen.queryByText("Typical peak: September.")).toBeNull();
});
it("shows an error without a redundant retry and reloads when scope changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => result }),
  );
  const { rerender } = render(<CriticalPeriods {...props} />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Retry seasonal summary" })).toBeNull();
  rerender(<CriticalPeriods {...props} region="Bali" />);
  await screen.findByText("Typical peak: September.");
});
