import { archiveMapCache } from "@/lib/firewatch/archive-map-cache";
import { CoordinateSearch } from "./CoordinateSearch";
import { PagedValueTable } from "./AnalysisUI";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize } from "lucide-react";
import type { Map as LMap, LayerGroup, TileLayer, Renderer } from "leaflet";
import { useText } from "@/lib/firewatch/i18n";
import type { MapView } from "./FireMap";
import { provincePlaces } from "@/lib/firewatch/province-places";
import { observationBounds } from "@/lib/firewatch/map-grid";
const API = import.meta.env["VITE_ARCHIVE_API"] ?? "";
interface Props {
  query: string;
  view: MapView;
  density: boolean;
  boundaries: boolean;
  light?: boolean;
  onSelect: (id: string) => void;
  controls?: ReactNode;
}
export function ArchiveMap({
  query,
  view,
  density,
  boundaries,
  light = false,
  onSelect,
  controls,
}: Props) {
  const text = useText();
  const element = useRef<HTMLDivElement>(null),
    map = useRef<LMap | null>(null),
    layer = useRef<LayerGroup | null>(null),
    boundary = useRef<LayerGroup | null>(null),
    leaflet = useRef<typeof import("leaflet") | null>(null),
    callback = useRef(onSelect);
  callback.current = onSelect;
  const [mapData, setMapData] = useState<any>(null);
  const tiles = useRef<TileLayer[]>([]);
  const countryGeometry = useRef<any>(null);
  const countryRenderer = useRef<Renderer | null>(null);
  const hoverArea = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false),
    [viewport, setViewport] = useState(0),
    [status, setStatus] = useState("Loading all selected observations…"),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true);
  const [places, setPlaces] = useState<ReturnType<typeof provincePlaces>>([]);
  const [visibleClusters, setVisibleClusters] = useState<any[]>([]);
  const [retry, setRetry] = useState(0);
  const [boundaryError, setBoundaryError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  useEffect(() => {
    const changed = () => {
      const host = element.current?.closest(".archive-map-panel");
      const active = !!host && document.fullscreenElement === host;
      setFullscreen(active);
      map.current?.invalidateSize?.();
      if (wasFullscreen.current && !active) fullscreenButton.current?.focus();
      wasFullscreen.current = active;
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    const host = element.current?.closest<HTMLElement>(".archive-map-panel");
    if (!host) return;
    setFullscreenError("");
    try {
      if (document.fullscreenElement === host) await document.exitFullscreen();
      else if (host.requestFullscreen) await host.requestFullscreen();
      else throw Error("Fullscreen is not supported by this browser.");
    } catch (error) {
      setFullscreenError(error instanceof Error ? error.message : "Unable to open fullscreen.");
    }
  }
  useEffect(() => {
    let cancelled = false;
    let moveTimer: ReturnType<typeof setTimeout>;
    import("leaflet").then((mod) => {
      if (cancelled || !element.current || map.current) return;
      const L = mod;
      leaflet.current = L;
      const m = L.map(element.current, {
        preferCanvas: true,
        minZoom: 4,
        maxZoom: 16,
        zoomControl: false,
      }).fitBounds([
        [-11, 95],
        [6, 141],
      ]);
      map.current = m;
      // SVG supports the country grid fill and redraws it correctly on zoom.
      m.createPane("archive-boundaries").style.zIndex = "450";
      const labels = m.createPane("archive-labels");
      labels.style.zIndex = "620";
      labels.style.pointerEvents = "none";
      countryRenderer.current = L.svg({ pane: "archive-boundaries", padding: 0.5 });
      layer.current = L.layerGroup().addTo(m);
      boundary.current = L.layerGroup().addTo(m);
      hoverArea.current = L.layerGroup().addTo(m);
      L.control.zoom({ position: "bottomright" }).addTo(m);
      const base = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
      tiles.current = [
        L.tileLayer(base + "/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
          maxNativeZoom: 16,
          attribution:
            "Basemap © Esri, HERE, Garmin, OpenStreetMap contributors · NASA FIRMS real archive",
        }).addTo(m),
        L.tileLayer(base + "/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
          maxNativeZoom: 16,
          pane: "archive-labels",
        }).addTo(m),
      ];
      m.on("moveend", () => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => setViewport((v) => v + 1), 200);
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(moveTimer);
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const theme = light ? "Light" : "Dark";
    const base = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
    tiles.current[0]?.setUrl(`${base}/World_${theme}_Gray_Base/MapServer/tile/{z}/{y}/{x}`);
    tiles.current[1]?.setUrl(`${base}/World_${theme}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`);
  }, [ready, light]);
  useEffect(() => {
    if (!ready || !element.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => map.current?.invalidateSize());
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    const m = map.current,
      L = leaflet.current,
      g = layer.current;
    if (!ready || !m || !L || !g) return;
    const abort = new AbortController();
    const zoom = Math.round(m.getZoom());
    const bounds = m.getBounds();
    const scope = query + "|" + view;
    const cached = archiveMapCache.find(
      (entry) =>
        entry.scope === scope &&
        entry.expiresAt > Date.now() &&
        entry.zoom === zoom &&
        entry.west <= bounds.getWest() &&
        entry.east >= bounds.getEast() &&
        entry.south <= bounds.getSouth() &&
        entry.north >= bounds.getNorth(),
    );
    setFailed(false);
    if (cached) {
      setMapData({ scope, result: cached.result });
      setLoading(false);
      return;
    }
    // Preload a half-screen margin so short pans reuse the same response.
    const width = bounds.getEast() - bounds.getWest();
    const height = bounds.getNorth() - bounds.getSouth();
    const area = {
      west: Math.min(180, Math.max(-180, bounds.getWest() - width * 0.5)),
      east: Math.max(-180, Math.min(180, bounds.getEast() + width * 0.5)),
      south: Math.max(-90, bounds.getSouth() - height * 0.5),
      north: Math.min(90, bounds.getNorth() + height * 0.5),
    };
    const q = new URLSearchParams(query);
    q.set("view", view);
    q.set("zoom", String(zoom));
    for (const [key, value] of Object.entries(area)) q.set(key, String(value));
    setLoading(true);
    setStatus("Loading visible observations.");
    fetch(API + "/api/archive/map?" + q, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("Map data unavailable");
        return r.json();
      })
      .then((result) => {
        if (abort.signal.aborted) return;
        archiveMapCache.unshift({
          scope,
          zoom,
          ...area,
          result,
          expiresAt: Date.now() + 5 * 60_000,
        });
        archiveMapCache.length = Math.min(archiveMapCache.length, 8);
        setMapData({ scope, result });
        setLoading(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") {
          setLoading(false);
          setFailed(true);
          setStatus(e.message);
        }
      });
    return () => abort.abort();
  }, [ready, query, view, viewport, retry]);
  useEffect(() => {
    const m = map.current,
      L = leaflet.current,
      g = layer.current;
    if (!ready || !m || !L || !g || !mapData) return;
    if (mapData.scope !== query + "|" + view) {
      g.clearLayers();
      hoverArea.current?.clearLayers();
      setVisibleClusters([]);
      return;
    }
    const result = mapData.result;
    g.clearLayers();
    hoverArea.current?.clearLayers();
    const css = (key: string) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--" + key)
        .trim();
    const colors = [css("matched"), css("possible"), css("modis"), css("viirs")];
    const compactCount = new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    const bounds = m.getBounds().pad(0);
    const visible = result.clusters.filter((point: any) => bounds.contains([point.lat, point.lon]));
    setVisibleClusters(visible);
    for (const point of visible) {
      const values =
        view === "modis"
          ? [0, 0, point.count, 0]
          : view === "viirs"
            ? [0, 0, 0, point.count]
            : [point.matched, point.possible, point.modis_only, point.viirs_only];
      const dominant = values.indexOf(Math.max(...values));
      const color = colors[dominant] ?? colors[2];
      const radius = Math.min(31, 5 + Math.log2(point.count + 1) * 2);
      if (density) {
        for (const [factor, opacity] of [
          [2.8, 0.035],
          [2.1, 0.07],
          [1.5, 0.12],
          [1, 0.2],
        ])
          L.circleMarker([point.lat, point.lon], {
            radius: radius * factor!,
            stroke: false,
            fillColor: color,
            fillOpacity: opacity!,
            interactive: false,
          }).addTo(g);
      }
      let end = 0;
      const gradient = values
        .map((n: number, i: number) => {
          const start = end;
          end += (n / point.count) * 100;
          return `${colors[i]} ${start}% ${end}%`;
        })
        .join(",");
      const isSingle = point.count === 1;
      const selectionHint = isSingle
        ? "Click for source details"
        : m.getZoom() >= 16
          ? "Maximum zoom: click for one representative source record"
          : "Click to zoom; all records included";
      const outlined =
        view === "harmonized" && (point.modis_only === 1 || point.viirs_only === 1) && isSingle;
      const size = isSingle ? 8 : Math.min(36, 18 + Math.log2(point.count) * 1.3);
      const icon = L.divIcon({
        className: "archive-map-marker",
        html: `<div style="width:${size}px;height:${size}px;position:relative;box-sizing:border-box;border-radius:50%;background:${outlined ? "transparent" : isSingle ? color : `conic-gradient(${gradient})`};border:1.5px solid ${color};box-shadow:0 1px 3px color-mix(in oklab,${color} 20%,transparent)">${isSingle ? "" : `<span class="archive-cluster-count">${compactCount.format(point.count)}</span>`}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      if (point.anomaly_count > 0)
        L.circleMarker([point.lat, point.lon], {
          radius: size / 2 + 3,
          color: css("map-anomaly"),
          weight: 1,
          opacity: 0.55,
          dashArray: "3 3",
          fill: false,
          interactive: false,
        }).addTo(g);
      L.marker([point.lat, point.lon], {
        icon,
        keyboard: true,
        title: isSingle
          ? text("Inspect observation")
          : `${point.count.toLocaleString()} ${view === "harmonized" ? "activity units" : "source detections"}; zoom to expand`,
      })
        .bindTooltip(
          `${point.count.toLocaleString()} ${text(view === "harmonized" ? "activity units" : "source detections")}<br>Source members: MODIS ${(view === "harmonized" ? (point.source_modis ?? point.modis) : point.modis).toLocaleString()} · VIIRS ${(view === "harmonized" ? (point.source_viirs ?? point.viirs) : point.viirs).toLocaleString()}<br>${text(selectionHint)}`,
          { className: "fw-tip", direction: "auto", offset: [28, 0], opacity: 1 },
        )
        .on("mouseover", () => {
          hoverArea.current?.clearLayers();
          const bounds = observationBounds(point);
          if (bounds && hoverArea.current)
            L.rectangle(bounds, {
              renderer: countryRenderer.current ?? undefined,
              pane: "archive-boundaries",
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: 0.12,
              dashArray: "5 4",
              interactive: false,
            }).addTo(hoverArea.current);
        })
        .on("mouseout", () => hoverArea.current?.clearLayers())
        .on("click", () => {
          if (isSingle) callback.current(point.id);
          else if (m.getZoom() < 16)
            m.setView([point.lat, point.lon], Math.min(16, m.getZoom() + 2), { animate: false });
          else callback.current(point.id);
        })
        .addTo(g);
    }
    setStatus(
      `${result.total.toLocaleString()} ${text(view === "harmonized" ? "activity units" : "source detections")} in applied selection · ${visible.length.toLocaleString()} displayed clusters. Cluster counts are not confirmed fires.`,
    );
  }, [ready, mapData, query, view, density, viewport, light, text]);
  useEffect(() => {
    const L = leaflet.current,
      g = boundary.current;
    if (!ready || !L || !g) return;
    setBoundaryError("");
    g.clearLayers();
    const abort = new AbortController();
    const geometry = countryGeometry.current
      ? Promise.resolve(countryGeometry.current)
      : fetch(API + "/api/archive/boundaries", { signal: abort.signal }).then((r) => {
          if (!r.ok) throw Error("Province boundaries unavailable");
          return r.json();
        });
    geometry
      .then((geo) => {
        countryGeometry.current = geo;
        if (!abort.signal.aborted) setPlaces(provincePlaces(geo));
        if (!abort.signal.aborted)
          L.geoJSON(geo, {
            pane: "archive-boundaries",
            style: {
              renderer: countryRenderer.current ?? undefined,
              color: light ? "#276749" : "#a6d9c0",
              weight: boundaries ? 1.5 : 0,
              opacity: 0.9,
              fillColor: "url(#indonesia-grid)",
              fillOpacity: 0.2,
            },
            interactive: false,
          }).addTo(g);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setBoundaryError(
            "Province boundaries and place search unavailable. Coordinate search still works.",
          );
        }
      });
    return () => abort.abort();
  }, [ready, boundaries, light, retry]);
  return (
    <>
      <div className="archive-map-stage">
        {controls}
        <CoordinateSearch map={ready ? map.current : null} places={places} />
        <svg width="0" height="0" aria-hidden="true" className="absolute">
          <defs>
            <pattern id="indonesia-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="10" height="10" fill="var(--primary)" opacity="0.15" />
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--primary)" strokeWidth="0.6" />
            </pattern>
          </defs>
        </svg>
        <div
          ref={element}
          className="fw-map h-full w-full"
          role="region"
          aria-label="Indonesia map of selected archive records in the visible area"
          aria-busy={loading}
        />
        <button
          ref={fullscreenButton}
          className="map-fullscreen-button archive-button"
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          disabled={!ready}
          onClick={toggleFullscreen}
        >
          {fullscreen ? (
            <Minimize size={18} aria-hidden="true" />
          ) : (
            <Maximize size={18} aria-hidden="true" />
          )}
        </button>
        {loading && (
          <div
            className={
              mapData ? "map-loading-overlay map-background-loading" : "map-loading-overlay"
            }
            role="status"
            aria-live="polite"
            data-testid="map-loading"
          >
            <div className="map-loading-message">
              <span className="loading-spinner" aria-hidden="true" />
              {text("Loading real observations…")}
            </div>
          </div>
        )}
      </div>
      {fullscreenError && <div role="alert">{fullscreenError}</div>}
      {boundaryError && (
        <div role="alert">
          {boundaryError}{" "}
          <button className="archive-button" onClick={() => setRetry((v) => v + 1)}>
            Retry place search
          </button>
        </div>
      )}
      {status && (
        <div
          role={failed ? "alert" : "status"}
          className="absolute bottom-0 left-0 z-[550] w-full bg-background/95 px-3 py-2 text-xs text-foreground"
        >
          {text(status)}
          {failed && (
            <button className="archive-button ml-3" onClick={() => setRetry((v) => v + 1)}>
              Retry map
            </button>
          )}
          {!loading && (
            <button
              className="float-right"
              aria-label="Dismiss map status"
              onClick={() => setStatus("")}
            >
              ×
            </button>
          )}
        </div>
      )}
      <PagedValueTable
        key={query + view}
        loading={loading}
        caption="Visible map clusters"
        headers={[
          "Latitude",
          "Longitude",
          view === "harmonized" ? "Activity units" : "Source detections",
          "Action",
        ]}
        rows={visibleClusters.map((point) => [
          point.lat.toFixed(4),
          point.lon.toFixed(4),
          point.count.toLocaleString(),
          <button
            className="archive-button"
            onClick={() => {
              if (point.count === 1 || map.current!.getZoom() >= 16) callback.current(point.id);
              else
                map.current!.setView(
                  [point.lat, point.lon],
                  Math.min(16, map.current!.getZoom() + 2),
                  { animate: false },
                );
            }}
          >
            {point.count === 1
              ? "Inspect observation"
              : map.current!.getZoom() >= 16
                ? "Inspect representative record"
                : "Explore cluster"}
          </button>,
        ])}
      />
    </>
  );
}
