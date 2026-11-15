vi.mock("@/lib/firewatch/default-map-snapshot", () => ({ loadDefaultSnapshot: vi.fn() }));
import { loadDefaultSnapshot } from "@/lib/firewatch/default-map-snapshot";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { RealDashboard } from "./RealDashboard";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";

async function renderDashboard() {
  const root = createRootRoute({ component: RealDashboard });
  const child = createRoute({ getParentRoute: () => root, path: "/$page", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([child]),
    history: createMemoryHistory({ initialEntries: ["/map"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Filters" });
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  return router;
}
vi.mock("./ArchiveMap", () => ({
  ArchiveMap: ({ query, controls }: { query: string; controls?: import("react").ReactNode }) => (
    <div data-testid="archive-map" data-query={query}>
      {controls}
      Map renderer
    </div>
  ),
}));
vi.mock("./ArchiveHeatmap", () => ({
  ArchiveHeatmap: ({ query }: { query: string }) => (
    <div data-testid="frp-map" data-query={query} />
  ),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: () => <div>Monthly chart</div>,
  BarChart: () => <div>Monthly activity bar chart</div>,
  Bar: () => null,
  Legend: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));
const summary = {
  total: 25,
  modis: 10,
  viirs: 15,
  matched: 2,
  possible: 1,
  modis_only: 7,
  viirs_only: 12,
  activity: 22,
};
beforeEach(() => {
  vi.mocked(loadDefaultSnapshot).mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes("/sensitivity") || url.includes("/candidates"))
          return { data: [], total: 0 };
        if (url.includes("/critical-periods"))
          return {
            available: false,
            months: [],
            years: [],
            reference_years: [2022, 2023, 2024, 2025],
            typical_peak_months: [],
            comparable_months: 0,
          };
        if (url.includes("/meta"))
          return { records: 617112, regions: ["Bali"], processed_at: "2026-11-14", config: {} };
        if (url.includes("/history"))
          return [
            {
              year: 2025,
              summary: { ...summary, days_with_records: 30 },
              monthly: [{ period: 9, modis: 10, viirs: 15, activity: 22 }],
              regions: [{ region: "Bali", activity: 22 }],
            },
          ];
        if (url.includes("/calendar"))
          return {
            year: 2022,
            month: 1,
            days: [{ date: "2022-01-01", day: 1, activity: 12, in_range: true }],
            thresholds: [5, 10, 15],
            weekday_offset: 6,
            activity: 12,
          };
        if (url.includes("/day?"))
          return {
            date: "2022-01-01",
            summary: { ...summary, activity: 12 },
            regions: [{ region: "Bali", activity: 12 }],
          };
        if (url.includes("/anomalies")) return { data: [], method: "Exploratory" };
        if (url.includes("/forecast")) return { available: false, reason: "Insufficient data" };
        return {
          summary,
          observations: [],
          monthly: [],
          daily: [],
          scope: { year: 2025 },
          map_page: { returned: 0, total: 25 },
        };
      },
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Real archive dashboard", () => {
  it("applies map detection and date filters together and closes the panel with Escape", async () => {
    await renderDashboard();
    const map = screen.getByTestId("archive-map");
    fireEvent.change(screen.getByLabelText("Detection scope"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    expect(map).toHaveAttribute("data-query", "year=2022&month=1&detection_type=vegetation");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(map).toHaveAttribute("data-query", "year=2024&month=1&detection_type=all"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(map).toHaveAttribute("data-query", "year=2024&month=1&detection_type=all");
    fireEvent.keyDown(screen.getByRole("region", { name: "Map filters" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Map filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();
  });
  it("exports the returned analysis scope and values after loading completes", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:analysis");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await renderDashboard();
      const button = screen.getByRole("button", { name: "Export analysis" });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      const payload = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(JSON.parse(payload)).toMatchObject({ scope: { year: 2025 }, summary });
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:analysis");
    } finally {
      click.mockRestore();
    }
  });
  it("applies detection scope across pages and disables dashboard exports on unrelated pages", async () => {
    await renderDashboard();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export analysis" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("link", { name: "FRP heatmap" }));
    await screen.findByTestId("frp-map");
    expect(screen.getByRole("button", { name: "Export analysis" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Detection scope"), { target: { value: "all" } });
    expect(screen.getByTestId("frp-map")).toHaveAttribute(
      "data-query",
      "year=2022&month=1&detection_type=vegetation",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply detection scope" }));
    expect(screen.getByTestId("frp-map")).toHaveAttribute(
      "data-query",
      "year=2022&month=1&detection_type=all",
    );
    fireEvent.click(screen.getByRole("link", { name: "Map" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/dashboard?year=2022&month=1&detection_type=all"),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export analysis" })).toBeEnabled(),
    );
  });
  it("provides every selected calendar year and describes the filtered color scale", async () => {
    await renderDashboard();
    fireEvent.change(screen.getByLabelText("Period mode"), { target: { value: "range" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2023-12-25" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2024-01-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("link", { name: "Calendar" }));
    const picker = await screen.findByRole("combobox", { name: "Displayed calendar year" });
    expect(picker.querySelectorAll("option")).toHaveLength(2);
    fireEvent.change(picker, { target: { value: "2024" } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "calendar-year?year=2024&detection_type=vegetation&start_date=2023-12-25&end_date=2024-01-05",
        ),
        expect.anything(),
      ),
    );
    expect(screen.getByText(/Activity colors: selected dates/)).toBeTruthy();
  });
  it("waits for Apply before requesting a new period, collapses navigation and disables identical modes", async () => {
    await renderDashboard();
    await waitFor(() =>
      expect(screen.getByTestId("archive-map")).toHaveAttribute(
        "data-query",
        "year=2022&month=1&detection_type=vegetation",
      ),
    );
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    expect(screen.getByTestId("archive-map")).toHaveAttribute(
      "data-query",
      "year=2022&month=1&detection_type=vegetation",
    );
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes("year=2024"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(screen.getByTestId("archive-map")).toHaveAttribute(
        "data-query",
        "year=2024&month=1&detection_type=vegetation",
      ),
    );
    expect(screen.getAllByRole("link", { name: "FRP heatmap" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    fireEvent.click(screen.getByRole("link", { name: "Calendar" }));
    expect(screen.queryByRole("group", { name: "Audience" })).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getByRole("group", { name: "Daily activity for the whole year" })
          .closest(".section-loading-container"),
      ).toHaveAttribute("aria-busy", "false"),
    );
  });
  it("filters Overview by year or whole year without returning to the map", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    await screen.findByLabelText("Archive year");
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.change(screen.getByLabelText("Period mode"), { target: { value: "year" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/dashboard\?year=2024&detection_type=vegetation$/),
        expect.anything(),
      ),
    );
    expect(screen.queryByText("Possible groups")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    expect(await screen.findByText("Possible groups")).toBeTruthy();
  });
  it("applies custom dates directly to the FRP heatmap query", async () => {
    await renderDashboard();
    fireEvent.click(screen.getAllByRole("link", { name: "FRP heatmap" })[0]!);
    fireEvent.change(screen.getByLabelText("Period mode"), { target: { value: "range" } });
    await screen.findByLabelText("Start date");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2023-06-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2023-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("frp-map")).toHaveAttribute(
      "data-query",
      "start_date=2023-06-01&end_date=2023-06-30&detection_type=vegetation",
    );
  });
  it("filters anomalies by year and month, shows a chart and an empty state", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (String(url).includes("/anomalies"))
        return {
          ok: true,
          json: async () => ({
            method: "Exploratory",
            data: [{ region: "Bali", month: 2, observed: 100, median: 10, z: 5 }],
          }),
        } as Response;
      return original(url, options);
    });
    await renderDashboard();
    fireEvent.click(screen.getByRole("link", { name: "Anomalies" }));
    await screen.findByRole("img", {
      name: "Observed activity compared with historical baseline by month",
    });
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/anomalies?year=2024"),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText("Period mode"), { target: { value: "month" } });
    fireEvent.change(screen.getByLabelText("Archive month"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/No flagged anomalies for this period/);
    expect(screen.queryByText("Robust z")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    expect(screen.getByText("Robust z")).toBeTruthy();
  });
  it("shows every day of the selected year including leap day", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("link", { name: "Calendar" }));
    const grid = await screen.findByRole("group", { name: "Daily activity for the whole year" });
    await within(grid).findByLabelText("2022-01-01: 12 activity units");
    expect(grid.querySelectorAll("button")).toHaveLength(365);
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(grid.querySelectorAll("button")).toHaveLength(366));
    expect(within(grid).getByLabelText(/^2024-02-29:/)).toBeTruthy();
    expect(within(grid).queryByLabelText(/^2024-02-30:/)).toBeNull();
  });
  it("shows forecast values from the API with a working grid toggle", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (String(url).includes("/forecast"))
        return {
          ok: true,
          json: async () => ({
            available: true,
            model: "seasonal_mean",
            mae: { seasonal_naive: 3, seasonal_mean: 2 },
            outlook: [{ month: 1, point: 42, low: 30, high: 50 }],
            backtest: [],
          }),
        } as Response;
      return original(url, options);
    });
    await renderDashboard();
    fireEvent.click(screen.getByRole("link", { name: "Prediction" }));
    const toggle = await screen.findByRole("button", { name: "Hide grid" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("cell", { name: "42" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show grid" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("requests January 2022 initially and restores it when filters reset", async () => {
    await renderDashboard();
    expect(screen.getByLabelText("Archive year")).toHaveValue("2022");
    expect(screen.getByLabelText("Archive month")).toHaveValue("1");
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/archive/dashboard?year=2022&month=1"),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId("archive-map")).toHaveAttribute(
      "data-query",
      "year=2022&month=1&detection_type=vegetation",
    );
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Period mode"), { target: { value: "year" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("archive-map")).toHaveAttribute(
      "data-query",
      "detection_type=vegetation",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("archive-map")).toHaveAttribute(
      "data-query",
      "year=2022&month=1&detection_type=vegetation",
    );
  });
  it("loads metadata, legend and filters the API", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    await screen.findByText(/617,112 imported source records/);
    expect(screen.getAllByText("MODIS-only", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Anomaly region (separate flag)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("year=2024"), expect.anything()),
    );
  });
  it("date ranges clear conflicting year/month and calendar reveals day details", async () => {
    await renderDashboard();
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2025" } });
    fireEvent.change(screen.getByLabelText("Archive month"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Period mode"), { target: { value: "range" } });
    expect(screen.queryByLabelText("Archive year")).toBeNull();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2022-01-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2022-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/dashboard\?.*start_date=2022-01-01.*end_date=2022-12-31/),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("link", { name: "Calendar" }));
    const calendar = await screen.findByRole("group", {
      name: "Daily activity for the whole year",
    });
    fireEvent.click(
      await within(calendar).findByRole("button", { name: "2022-01-01: 12 activity units" }),
    );
    await screen.findByRole("button", { name: "Show this day on map" });
    expect(screen.queryByText("Next page")).toBeNull();
    expect(screen.queryByTestId("archive-map")).toBeNull();
    expect(screen.queryByText("Sensor contribution")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show this day on map" }));
    await screen.findByTestId("archive-map");
    expect(screen.getByTestId("archive-map")).toHaveAttribute(
      "data-query",
      "start_date=2022-01-01&end_date=2022-01-01&detection_type=vegetation",
    );
  });
  it("shows a connection error instead of generated data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    await renderDashboard();
    expect(await screen.findByText(/Archive request failed \(503\)/)).toBeTruthy();
    expect(screen.queryByText("Sample archive")).toBeNull();
  });
  it("loads analytics only on their pages and preserves the selected filters", async () => {
    await renderDashboard();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/forecast"))).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText("Archive year"), { target: { value: "2024" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("link", { name: "Prediction" }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/forecast"))).toBe(
        true,
      ),
    );
    expect(screen.queryByTestId("archive-map")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Map" }));
    await screen.findByTestId("archive-map");
    expect(screen.getByLabelText("Archive year")).toHaveValue("2024");
  });
  it("translates navigation and controls and exposes a Help page", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "ID" }));
    expect(screen.getByRole("button", { name: "Umum" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Teknis" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Bantuan" }));
    expect(await screen.findByRole("heading", { name: "Bantuan & membaca peta" })).toBeTruthy();
  });
});

it("shows the saved summary while the default dashboard API request is pending", async () => {
  vi.mocked(loadDefaultSnapshot).mockResolvedValue({
    schema_version: 1,
    version: "synthetic-version",
    generated_at: "2026-01-01T00:00:00Z",
    archive_processed_at: null,
    maps: {},
    dashboard: { summary, monthly: [], daily: [], observations: [], scope: {} },
  });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((...args) => {
    if (String(args[0]).includes("/dashboard?")) {
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return originalFetch(...args);
  });
  await renderDashboard();
  await screen.findByText(/Summary from saved archive data/);
  finish({
    ok: true,
    json: async () => ({ summary, monthly: [], daily: [], observations: [], scope: {} }),
  } as Response);
  await waitFor(() => expect(screen.queryByText(/Summary from saved archive data/)).toBeNull());
});
