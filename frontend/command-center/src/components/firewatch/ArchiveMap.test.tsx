vi.mock("@/lib/firewatch/default-map-snapshot", () => ({ loadDefaultSnapshot: vi.fn() }));
import { loadDefaultSnapshot } from "@/lib/firewatch/default-map-snapshot";
import { archiveMapCache } from "@/lib/firewatch/archive-map-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor, screen, fireEvent } from "@testing-library/react";
import { ArchiveMap } from "./ArchiveMap";

const mocks = vi.hoisted(() => {
  const bounds = {
    getWest: () => 100 + mocks.pan,
    getEast: () => 110 + mocks.pan,
    getSouth: () => -5,
    getNorth: () => 0,
    pad: () => ({ contains: () => true }),
  };
  return {
    move: () => {},
    zoom: 5,
    pan: 0,
    clearLayers: vi.fn(),
    invalidateSize: vi.fn(),
    setUrl: vi.fn(),
    geoJSON: vi.fn(() => ({ addTo: vi.fn() })),
    svg: vi.fn(() => ({ renderer: "svg" })),
    createPane: vi.fn(() => ({ style: {} as Record<string, string> })),
    divIcon: vi.fn((options) => options),
    bindTooltip: vi.fn(),
    markerEvents: new Map<string, () => void>(),
    rectangle: vi.fn(() => ({ addTo: vi.fn() })),
    bounds,
  };
});
vi.mock("leaflet", () => ({
  map: () => {
    const map = {
      fitBounds: () => map,
      getBounds: () => mocks.bounds,
      getZoom: () => mocks.zoom,
      on: (_: string, callback: () => void) => {
        mocks.move = callback;
      },
      remove: vi.fn(),
      invalidateSize: mocks.invalidateSize,
      createPane: mocks.createPane,
    };
    return map;
  },
  layerGroup: () => ({ addTo: () => ({ clearLayers: mocks.clearLayers }) }),
  control: { zoom: () => ({ addTo: vi.fn() }) },
  tileLayer: () => {
    const tile = { addTo: () => tile, setUrl: mocks.setUrl };
    return tile;
  },
  geoJSON: mocks.geoJSON,
  svg: mocks.svg,
  divIcon: mocks.divIcon,
  marker: () => {
    const marker = {
      bindTooltip: (content: string, options: unknown) => {
        mocks.bindTooltip(content, options);
        return marker;
      },
      on: (name: string, callback: () => void) => {
        mocks.markerEvents.set(name, callback);
        return marker;
      },
      addTo: () => marker,
    };
    return marker;
  },
  circleMarker: () => ({ addTo: vi.fn() }),
  rectangle: mocks.rectangle,
}));
const props = {
  query: "year=2022&month=1",
  view: "harmonized" as const,
  density: false,
  boundaries: false,
  onSelect: vi.fn(),
};
const result = { clusters: [], represented: 0, total: 0 };
function mapCalls() {
  return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/map?"));
}

beforeEach(() => {
  vi.mocked(loadDefaultSnapshot).mockResolvedValue(null);
  archiveMapCache.length = 0;
  mocks.zoom = 5;
  mocks.pan = 0;
  mocks.clearLayers.mockClear();
  mocks.invalidateSize.mockClear();
  mocks.setUrl.mockClear();
  mocks.geoJSON.mockClear();
  mocks.svg.mockClear();
  mocks.createPane.mockClear();
  mocks.divIcon.mockClear();
  mocks.bindTooltip.mockClear();
  mocks.markerEvents.clear();
  mocks.rectangle.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => result })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("archive map background loading", () => {
  it("reuses successful viewports after leaving and returning to the map", async () => {
    const first = render(<ArchiveMap {...props} />);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    expect(mapCalls()).toHaveLength(1);
    first.unmount();
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    expect(mapCalls()).toHaveLength(1);
  });
  it("refreshes expired cached viewports", async () => {
    const first = render(<ArchiveMap {...props} />);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    first.unmount();
    archiveMapCache.forEach((entry) => {
      entry.expiresAt = 0;
    });
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(mapCalls()).toHaveLength(2));
  });

  it("keeps Values expanded through cached pans and requests for new areas", async () => {
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    const summary = screen.getByLabelText("View chart values: Visible map clusters");
    const details = summary.closest("details")!;
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    await act(async () => {
      mocks.pan = 2;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(
      screen.getByLabelText("View chart values: Visible map clusters").closest("details"),
    ).toBe(details);
    expect(details).toHaveAttribute("open");
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      mocks.pan = 30;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await waitFor(() => expect(finish).toBeDefined());
    expect(details).toHaveAttribute("open");
    expect(details).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Updating values…")).toBeTruthy();
    await act(async () => {
      finish({ ok: true, json: async () => result } as Response);
    });
    await waitFor(() => expect(details).toHaveAttribute("aria-busy", "false"));
    expect(
      screen.getByLabelText("View chart values: Visible map clusters").closest("details"),
    ).toBe(details);
    expect(details).toHaveAttribute("open");
  });
  it("expands the map panel and resizes after entering and leaving fullscreen", async () => {
    const { container } = render(
      <div className="archive-map-panel">
        <ArchiveMap {...props} />
      </div>,
    );
    const panel = container.firstElementChild as HTMLElement;
    const requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: panel });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(panel, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    try {
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Enter fullscreen" })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
      await screen.findByRole("button", { name: "Exit fullscreen" });
      expect(requestFullscreen).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
      await screen.findByRole("button", { name: "Enter fullscreen" });
      expect(exitFullscreen).toHaveBeenCalledOnce();
      expect(mocks.invalidateSize).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
      Reflect.deleteProperty(document, "exitFullscreen");
    }
  });
  it("outlines the observation extent only while hovered and offsets its tooltip", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...result,
        step: 1,
        clusters: [
          {
            gx: 290,
            gy: 88,
            lat: -2,
            lon: 110,
            south: -2.01,
            north: -1.99,
            west: 109.99,
            east: 110.01,
            count: 1,
            id: "one",
            modis: 1,
            viirs: 0,
            source_modis: 1,
            source_viirs: 1,
            matched: 1,
            possible: 0,
            modis_only: 1,
            viirs_only: 0,
            anomaly_count: 0,
          },
        ],
      }),
    } as Response);
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(mocks.markerEvents.has("mouseover")).toBe(true));
    expect(mocks.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("Source members: MODIS 1"),
      expect.anything(),
    );
    expect(mocks.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("VIIRS 1"),
      expect.anything(),
    );
    expect(mocks.rectangle).not.toHaveBeenCalled();
    mocks.markerEvents.get("mouseover")!();
    expect(mocks.rectangle).toHaveBeenCalledWith(
      [
        [-2.01, 109.99],
        [-1.99, 110.01],
      ],
      expect.objectContaining({ interactive: false }),
    );
    expect(mocks.bindTooltip).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ direction: "auto", offset: [28, 0] }),
    );
    const clears = mocks.clearLayers.mock.calls.length;
    mocks.markerEvents.get("mouseout")!();
    expect(mocks.clearLayers.mock.calls.length).toBe(clears + 1);
  });
  it("switches basemap tiles to light mode and highlights Indonesia", async () => {
    const { rerender } = render(<ArchiveMap {...props} />);
    await waitFor(() => expect(mocks.geoJSON).toHaveBeenCalled());
    expect(mocks.geoJSON).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        style: expect.objectContaining({ fillColor: "url(#indonesia-grid)", fillOpacity: 0.2 }),
      }),
    );
    rerender(<ArchiveMap {...props} light />);
    await waitFor(() =>
      expect(mocks.setUrl).toHaveBeenCalledWith(expect.stringContaining("World_Light_Gray_Base")),
    );
  });
  it("uses a persistent SVG boundary renderer through zoom changes and keeps labels above markers", async () => {
    render(<ArchiveMap {...props} boundaries />);
    await waitFor(() => expect(mapCalls()).toHaveLength(1));
    expect(mocks.geoJSON).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pane: "archive-boundaries",
        style: expect.objectContaining({ weight: 1.5, renderer: { renderer: "svg" } }),
      }),
    );
    const labelPane = mocks.createPane.mock.results[1]!.value;
    expect(labelPane.style.zIndex).toBe("620");
    expect(labelPane.style.pointerEvents).toBe("none");
    await act(async () => {
      mocks.zoom = 8;
      mocks.move();
    });
    await waitFor(() => expect(mapCalls()).toHaveLength(2));
    expect(mocks.geoJSON).toHaveBeenCalledTimes(1);
    expect(mocks.svg).toHaveBeenCalledTimes(1);
  });
  it("shows a centered loader only until map data finishes loading", async () => {
    let finish!: (response: Response) => void;
    let first = true;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("/map?") && first) {
        first = false;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return { ok: true, json: async () => result } as Response;
    });
    render(<ArchiveMap {...props} />);
    expect(screen.getByTestId("map-loading")).toHaveClass("map-loading-overlay");
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => {
      finish({ ok: true, json: async () => result } as Response);
    });

    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
  });
  it("keeps large clusters compact and preserves exact counts in tooltips", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...result,
        clusters: [
          {
            lat: -2,
            lon: 110,
            count: 617112,
            id: "cluster",
            modis: 106262,
            viirs: 510850,
            matched: 0,
            possible: 0,
            modis_only: 106262,
            viirs_only: 510850,
            anomaly_count: 1,
          },
        ],
      }),
    } as Response);
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(mocks.divIcon).toHaveBeenCalled());
    const icon = mocks.divIcon.mock.calls[0]![0];
    expect(icon.iconSize[0]).toBeLessThanOrEqual(36);
    expect(icon.html).not.toContain("box-shadow:0 0");
    expect(mocks.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("617,112"),
      expect.anything(),
    );
  });
  it("fetches a buffered viewport and reuses it for nearby pans and density changes", async () => {
    const { rerender } = render(<ArchiveMap {...props} />);
    await waitFor(() => expect(mapCalls()).toHaveLength(1));
    expect(String(mapCalls()[0]![0])).toContain("west=95");
    await act(async () => {
      mocks.pan = 2;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    rerender(<ArchiveMap {...props} density />);
    await act(async () => {});
    expect(mapCalls()).toHaveLength(1);
  });
  it("debounces navigation, loads uncovered areas and reuses previous viewports", async () => {
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    await act(async () => {
      mocks.pan = 20;
      mocks.move();
      mocks.pan = 30;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await waitFor(() => expect(mapCalls()).toHaveLength(2));
    expect(String(mapCalls()[1]![0])).toContain("west=125");
    await act(async () => {
      mocks.pan = 0;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(mapCalls()).toHaveLength(2);
  });
  it("keeps the map visible during zoom requests and ignores obsolete responses", async () => {
    render(<ArchiveMap {...props} />);
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      mocks.zoom = 9;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.getByTestId("map-loading")).toHaveClass("map-background-loading");
    const obsolete = finish;
    const signal = mapCalls()[1]![1]!.signal!;
    await act(async () => {
      mocks.zoom = 10;
      mocks.move();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      obsolete({ ok: true, json: async () => result } as Response);
    });
    expect(screen.getByTestId("map-loading")).toBeTruthy();
    await act(async () => {
      finish({ ok: true, json: async () => result } as Response);
    });
    await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
  });
  it("invalidates cached clusters when filters change", async () => {
    const { rerender } = render(<ArchiveMap {...props} />);
    await waitFor(() => expect(mapCalls()).toHaveLength(1));
    await act(async () => {});
    rerender(<ArchiveMap {...props} query="year=2023&month=1" />);
    await waitFor(() => expect(mapCalls()).toHaveLength(2));
    expect(String(mapCalls()[1]![0])).toContain("year=2023");
  });
  it("shows a dismissible error if loading fails", async () => {
    vi.mocked(fetch).mockRejectedValue(Error("offline"));
    render(<ArchiveMap {...props} />);
    await screen.findByRole("button", { name: "Retry map" });
    expect(screen.getByRole("button", { name: "Dismiss map status" })).toBeTruthy();
  });
});

it("renders saved map observations before the API returns and keeps them if refresh fails", async () => {
  const point = {
    lat: -2,
    lon: 110,
    id: "saved",
    count: 1,
    modis: 1,
    viirs: 0,
    matched: 0,
    possible: 0,
    modis_only: 1,
    viirs_only: 0,
    anomaly_count: 0,
  };
  vi.mocked(loadDefaultSnapshot).mockResolvedValue({
    schema_version: 1,
    version: "test-version",
    generated_at: "2026-01-01T00:00:00Z",
    archive_processed_at: null,
    maps: { "harmonized:5": { ...result, total: 1, clusters: [point] } },
    dashboard: {},
  });
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes("/map?"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { ok: true, json: async () => result } as Response;
  });
  render(<ArchiveMap {...props} query="year=2022&month=1&detection_type=vegetation" />);
  await screen.findByTestId("map-snapshot-notice");
  expect(mocks.divIcon).toHaveBeenCalled();
  expect(screen.getByTestId("map-loading")).toHaveClass("map-background-loading");
  await act(async () => {
    finish({ ok: false } as Response);
  });
  await screen.findByText(/Update unavailable; saved data remains visible/);
  expect(screen.queryByRole("button", { name: "Retry map" })).toBeNull();
  expect(screen.queryByTestId("map-loading")).toBeNull();
});
it("does not let a late snapshot overwrite a completed live map response", async () => {
  let finish!: (snapshot: any) => void;
  vi.mocked(loadDefaultSnapshot).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<ArchiveMap {...props} />);
  await waitFor(() => expect(screen.queryByTestId("map-loading")).toBeNull());
  await act(async () => {
    finish({
      version: "old",
      generated_at: "2026-01-01T00:00:00Z",
      maps: { "harmonized:5": result },
    });
  });
  expect(screen.queryByTestId("map-snapshot-notice")).toBeNull();
});
