import { loadDefaultSnapshot } from "@/lib/firewatch/default-map-snapshot";
import { ArchiveFilters, type ArchiveScope } from "./ArchiveFilters";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Flame,
  Map,
  LayoutDashboard,
  CalendarDays,
  Satellite,
  History,
  ScanLine,
  ChartNoAxesCombined,
  BookOpen,
  CircleHelp,
  Grid2X2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { describeScope, pageGuides, Notice, ReadingGuide } from "./AnalysisUI";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
const CriticalPeriods = lazy(() =>
  import("./CriticalPeriods").then((m) => ({ default: m.CriticalPeriods })),
);
const ArchiveMap = lazy(() => import("./ArchiveMap").then((m) => ({ default: m.ArchiveMap })));
const ArchiveHeatmap = lazy(() =>
  import("./ArchiveHeatmap").then((m) => ({ default: m.ArchiveHeatmap })),
);
const ArchiveCalendar = lazy(() =>
  import("./ArchiveCalendar").then((m) => ({ default: m.ArchiveCalendar })),
);
const ActivityOverview = lazy(() =>
  import("./ArchiveVisuals").then((m) => ({ default: m.ActivityOverview })),
);
const SensorHarmonization = lazy(() =>
  import("./ArchiveVisuals").then((m) => ({ default: m.SensorHarmonization })),
);
const SituationShift = lazy(() =>
  import("./ArchiveVisuals").then((m) => ({ default: m.SituationShift })),
);
const MonthlySensorChart = lazy(() =>
  import("./AnalysisCharts").then((m) => ({ default: m.MonthlySensorChart })),
);
const FlaggedChart = lazy(() =>
  import("./AnalysisCharts").then((m) => ({ default: m.FlaggedChart })),
);
const OutlookChart = lazy(() =>
  import("./AnalysisCharts").then((m) => ({ default: m.OutlookChart })),
);
import { useEffect, useMemo, useState, useRef, lazy, Suspense } from "react";
import type { MapView } from "./FireMap";
import { I18nProvider, useT, useText, useMonths, type Lang } from "@/lib/firewatch/i18n";
const API = import.meta.env["VITE_ARCHIVE_API"] ?? "";
const DEFAULT_YEAR = 2022;
const DEFAULT_MONTH = "1";
async function request(path: string, signal?: AbortSignal) {
  const r = await fetch(API + path, signal ? { signal } : {});
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Error(
      typeof body.detail === "string"
        ? body.detail
        : r.status < 500
          ? `Check filter values (${r.status}).`
          : `Archive request failed (${r.status}). Check that the archive API is running.`,
    );
  }
  return r.json();
}
const fmt = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
export function RealDashboard() {
  const [lang, setLang] = useState<Lang>("en");
  return (
    <I18nProvider lang={lang}>
      <ArchiveDashboard lang={lang} setLang={setLang} />
    </I18nProvider>
  );
}
function ArchiveDashboard({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = useT();
  const text = useText();
  const MONTHS = useMonths();
  const [detectionType, setDetectionType] = useState<"vegetation" | "all">("vegetation");
  const [draftDetectionType, setDraftDetectionType] = useState<"vegetation" | "all">("vegetation");
  const [retry, setRetry] = useState(0);
  const selectionRequest = useRef(0);
  const [historyRegion, setHistoryRegion] = useState("");
  const loadedQuery = useRef<string | null>(null);
  const [summaryPreparedAt, setSummaryPreparedAt] = useState<string | null>(null);
  const page = useLocation({ select: (location) => location.pathname.split("/")[1] || "map" });
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const modesAvailable = ["map", "overview", "anomalies", "prediction"].includes(page);
  const [showFilters, setShowFilters] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [anomalyYear, setAnomalyYear] = useState(DEFAULT_YEAR);
  const [anomalyMonth, setAnomalyMonth] = useState("");
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const goToMap = () => navigate({ to: "/$page", params: { page: "map" } });
  const [meta, setMeta] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [data, setData] = useState<any>(null),
    [anomalies, setAnomalies] = useState<any>(null),
    [forecast, setForecast] = useState<any>(null),
    [evidence, setEvidence] = useState<any>(null),
    [sensitivity, setSensitivity] = useState<any>(null);
  const [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [year, setYear] = useState(DEFAULT_YEAR),
    [month, setMonth] = useState(DEFAULT_MONTH),
    [region, setRegion] = useState(""),
    [daynight, setDaynight] = useState(""),
    [view, setView] = useState<MapView>("harmonized"),
    [density] = useState(false),
    [boundaries, setBoundaries] = useState(false),
    [technical, setTechnical] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [light, setLight] = useState(false);
  const scope = useMemo(
    () => ({ year, month, startDate, endDate, region, daynight, detectionType }),
    [year, month, startDate, endDate, region, daynight, detectionType],
  );
  const applyScope = (next: ArchiveScope) => {
    if (next.detectionType && next.detectionType !== detectionType) {
      setDetectionType(next.detectionType);
      setDraftDetectionType(next.detectionType);
    }
    setYear(next.year);
    setMonth(next.month);
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    setRegion(next.region);
    setDaynight(next.daynight);
  };
  const anomalyScope = useMemo(
    () => ({
      year: anomalyYear,
      month: anomalyMonth,
      startDate: "",
      endDate: "",
      region: "",
      daynight: "",
    }),
    [anomalyYear, anomalyMonth, detectionType],
  );
  const analysisYear = year || (startDate ? Number(startDate.slice(0, 4)) : 2025);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !light);
    document.documentElement.lang = lang;
  }, [light, lang]);
  useEffect(() => {
    const abort = new AbortController();
    request("/api/archive/meta", abort.signal)
      .then((m) => {
        if (!abort.signal.aborted) setMeta(m);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  const [pageLoading, setPageLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setPageLoading(false);
    const tasks: Promise<unknown>[] = [];
    const load = (path: string, update: (result: any) => void) =>
      request(path, abort.signal).then((result) => {
        if (!abort.signal.aborted) update(result);
      });
    if (page === "history") {
      setHistory([]);
      tasks.push(
        load(
          "/api/archive/history?detection_type=" +
            detectionType +
            (historyRegion ? "&region=" + encodeURIComponent(historyRegion) : ""),
          setHistory,
        ),
      );
    }
    if (page === "prediction") {
      setForecast(null);
      tasks.push(load("/api/archive/forecast?detection_type=" + detectionType, setForecast));
    }
    if (page === "sensors" && !evidence)
      tasks.push(load("/api/archive/candidates?limit=30", setEvidence));
    if (page === "sensors" && !sensitivity)
      tasks.push(load("/api/archive/sensitivity", setSensitivity));
    if (tasks.length) {
      setPageLoading(true);
      Promise.all(tasks)
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setPageLoading(false);
        });
    }
    return () => abort.abort();
  }, [page, historyRegion, retry, detectionType]);
  useEffect(() => {
    const abort = new AbortController();
    if (!["map", "overview", "sensors"].includes(page)) return;
    setLoading(true);
    setError("");
    const q = new URLSearchParams();
    if (year && !startDate && !endDate) q.set("year", String(year));
    if (month && !startDate && !endDate) q.set("month", month);
    if (region) q.set("region", region);
    if (daynight) q.set("daynight", daynight);
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    q.set("detection_type", detectionType);
    if (loadedQuery.current === q.toString()) {
      setLoading(false);
      return;
    }
    setData(null);
    loadedQuery.current = null;
    setSummaryPreparedAt(null);
    let liveSucceeded = false;
    let hasSnapshot = false;
    loadDefaultSnapshot(q.toString())
      .then((snapshot) => {
        if (abort.signal.aborted || liveSucceeded || !snapshot) return;
        hasSnapshot = true;
        setData(snapshot.dashboard);
        setSummaryPreparedAt(snapshot.generated_at);
        setLoading(false);
        setError("");
      })
      .catch(() => {
        /* The API request still handles other scopes and errors. */
      });
    request("/api/archive/dashboard?" + q, abort.signal)
      .then((d) => {
        if (abort.signal.aborted) return;
        liveSucceeded = true;
        setSummaryPreparedAt(null);
        loadedQuery.current = q.toString();
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") {
          if (!hasSnapshot) setError(e.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [year, month, region, daynight, startDate, endDate, page, retry, detectionType]);
  useEffect(() => {
    const abort = new AbortController();
    if (!["overview", "anomalies"].includes(page)) return;
    if (page === "overview" && (!year || startDate || endDate || daynight)) {
      setAnomalies(null);
      return;
    }
    setAnomalies(null);
    setAnomalyLoading(true);
    request(
      "/api/archive/anomalies?year=" +
        (page === "anomalies" ? anomalyYear : analysisYear) +
        "&detection_type=" +
        detectionType,
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted) setAnomalies(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setAnomalyLoading(false);
      });
    return () => abort.abort();
  }, [analysisYear, anomalyYear, page, year, startDate, endDate, daynight, retry, detectionType]);
  const visibleAnomalies = (anomalies?.data ?? []).filter(
    (row: any) => !anomalyMonth || row.month === Number(anomalyMonth),
  );
  const monthly = useMemo(
    () =>
      MONTHS.map((label, i) => ({
        label,
        ...(data?.monthly.find((r: any) => r.period === i + 1) ?? {
          activity: null,
          modis: null,
          viirs: null,
        }),
      })).filter((_, i) => !month || startDate || endDate || i + 1 === Number(month)),
    [data, MONTHS, month, startDate, endDate],
  );
  const mapQuery = useMemo(() => {
    const q = new URLSearchParams();
    if (year && !startDate && !endDate) q.set("year", String(year));
    if (month && !startDate && !endDate) q.set("month", month);
    if (region) q.set("region", region);
    if (daynight) q.set("daynight", daynight);
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    q.set("detection_type", detectionType);
    return q.toString();
  }, [year, month, region, daynight, startDate, endDate, detectionType]);
  const summary = data?.summary;
  const scopedPage = ["map", "overview", "heatmap", "sensors", "calendar"].includes(page);
  const guide = pageGuides[page] ?? pageGuides["map"]!;
  const scopeLabel = describeScope(scope, MONTHS);
  const navIcons = [
    Map,
    Grid2X2,
    LayoutDashboard,
    CalendarDays,
    Satellite,
    History,
    ScanLine,
    ChartNoAxesCombined,
    BookOpen,
    CircleHelp,
  ];
  useEffect(() => {
    selectionRequest.current += 1;
    setSelected(null);
  }, [mapQuery]);
  async function selectObservation(id: string) {
    const token = ++selectionRequest.current;
    setSelected(null);
    try {
      const result = await request("/api/archive/observation/" + encodeURIComponent(id));
      if (token === selectionRequest.current) setSelected(result);
    } catch (e) {
      if (token === selectionRequest.current) setError(String(e));
    }
  }
  const retryRequests = () => {
    loadedQuery.current = null;
    setError("");
    setRetry((v) => v + 1);
  };
  function filter(action: () => void) {
    action();
  }
  const exportReady =
    ["map", "overview", "sensors"].includes(page) &&
    !loading &&
    !!data &&
    loadedQuery.current === mapQuery;
  function exportData() {
    if (!exportReady) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            scope: data.scope,
            summary: data.summary,
            monthly: data.monthly,
            daily: data.daily,
            coverage: data.coverage,
            config: meta?.config,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `firewatch-${data.scope.start_date ? data.scope.start_date + "_" + data.scope.end_date : data.scope.year || "2022-2025"}-${detectionType}-analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className={"archive-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
      <a className="skip-link" href="#analysis-main">
        Skip to analysis
      </a>
      <header className="sticky top-0 z-[900] border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <button
            className="archive-button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="archive-sidebar"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
          <div>
            <b className="brand-name">
              <Flame size={23} aria-hidden="true" />
              {text("FIREWATCH")}
            </b>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="segmented-control" role="group" aria-label="Language">
              <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                {text("EN")}
              </button>
              <button aria-pressed={lang === "id"} onClick={() => setLang("id")}>
                {text("ID")}
              </button>
            </div>
            <div className="segmented-control" role="group" aria-label="Color theme">
              <button aria-pressed={!light} onClick={() => setLight(false)}>
                {text("Dark")}
              </button>
              <button aria-pressed={light} onClick={() => setLight(true)}>
                {text("Light")}
              </button>
            </div>
            <button
              className="archive-button"
              disabled={!exportReady || !!error}
              title="Exports the selected Map, Overview, or Sensors analysis"
              onClick={exportData}
            >
              {text("Export analysis")}
            </button>
          </div>
        </div>
      </header>
      <aside id="archive-sidebar" className="archive-sidebar" hidden={sidebarCollapsed}>
        <nav aria-label="Main navigation">
          {[
            ["map", "Map"],
            ["heatmap", "FRP heatmap"],
            ["overview", t("nav_overview")],
            ["calendar", t("nav_calendar")],
            ["sensors", t("nav_sensors")],
            ["history", t("nav_history")],
            ["anomalies", t("nav_anomalies")],
            ["prediction", t("nav_prediction")],
            ["methodology", t("nav_method")],
            ["help", "Help"],
          ].map(([id, label], index) => (
            <Link
              key={id}
              to="/$page"
              params={{ page: id! }}
              aria-current={page === id ? "page" : undefined}
              className={"archive-nav-link " + (page === id ? "is-active" : "")}
            >
              {(() => {
                const Icon = navIcons[index]!;
                return <Icon size={18} aria-hidden="true" />;
              })()}
              <span>{text(String(label))}</span>
            </Link>
          ))}
        </nav>
        <p className="mt-6 text-xs text-muted-foreground">
          {text("NASA FIRMS · 2022–2025")}
          <br />
          {text("Historical observations")}
        </p>
      </aside>
      <main id="analysis-main" tabIndex={-1} className="archive-main space-y-5">
        <div className="page-heading">
          <h1>{text(guide.title)}</h1>
          {modesAvailable && (
            <div className="segmented-control" role="group" aria-label="Audience">
              <button
                disabled={!modesAvailable}
                title={!modesAvailable ? "This page is identical in both modes" : "Key summaries"}
                aria-pressed={!technical}
                onClick={() => setTechnical(false)}
              >
                {t("public")}
              </button>
              <button
                disabled={!modesAvailable}
                title={
                  !modesAvailable
                    ? "This page is identical in both modes"
                    : "Detailed measurements and methods"
                }
                aria-pressed={technical}
                onClick={() => setTechnical(true)}
              >
                {t("responder")}
              </button>
            </div>
          )}
        </div>
        {page !== "map" && (
          <form
            className="detection-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setDetectionType(draftDetectionType);
            }}
          >
            <label>
              Detection scope{" "}
              <select
                aria-label="Detection scope"
                value={draftDetectionType}
                onChange={(e) => setDraftDetectionType(e.target.value as "vegetation" | "all")}
              >
                <option value="vegetation">Presumed vegetation fires</option>
                <option value="all">All thermal detections</option>
              </select>
            </label>
            <button className="archive-button" type="submit">
              Apply detection scope
            </button>
            {draftDetectionType !== detectionType && (
              <span className="text-xs" role="status">
                Unapplied change
              </span>
            )}
          </form>
        )}

        {summaryPreparedAt && (
          <p className="chart-caption" role="status">
            Summary from saved archive data � prepared{" "}
            {new Date(summaryPreparedAt).toLocaleString()}.
          </p>
        )}
        {error && (
          <div role="alert" className="rounded border border-destructive p-4 text-destructive">
            {error}
            <button className="archive-button ml-3" onClick={retryRequests}>
              Retry requests
            </button>
            <button className="float-right" aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <div className="scope-bar" aria-label="Analysis scope">
          <div>
            <p>
              {scopedPage
                ? scopeLabel
                : page === "anomalies"
                  ? `${anomalyYear} · ${anomalyMonth ? MONTHS[Number(anomalyMonth) - 1] : "All months"} · All regions · Day + night`
                  : `2022–2025 · ${page === "history" && historyRegion ? historyRegion : "Indonesia"} · MODIS + VIIRS S-NPP · Day + night`}
            </p>
            <span>
              {detectionType === "vegetation" ? "Vegetation detections" : "All thermal detections"}
              {!scopedPage && " · Date and location filters do not apply"}
            </span>
          </div>
        </div>
        {scopedPage && page !== "map" && (
          <div id="map-filters" className="panel filter-panel">
            <ArchiveFilters value={scope} regions={meta?.regions ?? []} onApply={applyScope} />
          </div>
        )}
        <div
          className="page-content relative"
          aria-busy={
            pageLoading ||
            (["overview", "sensors"].includes(page) && loading) ||
            (page === "anomalies" && anomalyLoading)
          }
        >
          {(pageLoading ||
            (["overview", "sensors"].includes(page) && loading) ||
            (page === "anomalies" && anomalyLoading)) && (
            <div role="status" className="map-loading-overlay">
              <div className="map-loading-message">
                <span className="loading-spinner" />
                {text("Loading page data.")}
              </div>
            </div>
          )}
          <Suspense
            fallback={
              <div className="loading-notice" role="status">
                Loading analysis tools…
              </div>
            }
          >
            {page === "map" && (
              <>
                <section id="map" className="scroll-mt-32">
                  {technical && (
                    <p className="chart-caption">
                      {meta
                        ? `${fmt(meta.records)} imported source records`
                        : "Connecting to archive…"}{" "}
                      · Processed {meta?.processed_at?.slice(0, 19) ?? "unavailable"} UTC
                    </p>
                  )}
                  <div className="panel archive-map-panel relative overflow-hidden bg-map-surface">
                    <div className="map-view-controls">
                      <div
                        className="segmented-control"
                        role="group"
                        aria-label={text("Sensor view")}
                      >
                        {(["harmonized", "modis", "viirs"] as MapView[]).map((v) => (
                          <button
                            className={
                              "archive-button " +
                              (view === v ? "!bg-primary !text-primary-foreground" : "")
                            }
                            onClick={() => setView(v)}
                            aria-pressed={view === v}
                            key={v}
                          >
                            {v === "harmonized" ? t("harmonized") : v.toUpperCase()}
                          </button>
                        ))}
                      </div>

                      <button
                        className="archive-button"
                        aria-pressed={boundaries}
                        onClick={() => setBoundaries(!boundaries)}
                      >
                        {text(boundaries ? "Hide boundaries" : "Province boundaries")}
                      </button>
                    </div>
                    <ArchiveMap
                      query={mapQuery}
                      view={view}
                      density={density}
                      boundaries={boundaries}
                      light={light}
                      onSelect={selectObservation}
                      controls={
                        <div
                          className="map-filter-control"
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setShowFilters(false);
                              event.currentTarget
                                .querySelector<HTMLButtonElement>("button")
                                ?.focus();
                              event.stopPropagation();
                            }
                          }}
                        >
                          <button
                            className="archive-button map-filter-toggle"
                            aria-expanded={showFilters}
                            aria-controls="map-filter-panel"
                            onClick={() => setShowFilters(!showFilters)}
                          >
                            <SlidersHorizontal size={16} aria-hidden="true" />
                            {text("Filters")}
                          </button>
                          {showFilters && (
                            <section
                              id="map-filter-panel"
                              className="map-filter-popover"
                              aria-label="Map filters"
                            >
                              <div className="map-filter-heading">
                                <strong>{text("Filters")}</strong>
                                <button
                                  className="archive-button"
                                  aria-label="Close filters"
                                  onClick={() => setShowFilters(false)}
                                >
                                  <X size={16} aria-hidden="true" />
                                </button>
                              </div>
                              <ArchiveFilters
                                value={scope}
                                regions={meta?.regions ?? []}
                                includeDetectionType
                                onApply={applyScope}
                              />
                            </section>
                          )}
                        </div>
                      }
                    />
                    <details className="map-legend">
                      <summary>
                        Map legend · counts are activity units or source detections, never confirmed
                        fires
                      </summary>
                      <div className="legend-content">
                        <div className="mb-3 text-[10px] tracking-widest text-muted-foreground">
                          {text("SENSOR IDENTITY")}
                        </div>
                        <div className="flex gap-6">
                          <span>
                            <i className="legend-dot bg-modis" />
                            {text("MODIS")}
                          </span>
                          <span>
                            <i className="legend-dot bg-viirs" />
                            {text("VIIRS")}
                          </span>
                        </div>
                        <div className="mb-2 mt-4 text-[10px] tracking-widest text-muted-foreground">
                          {text("MATCH STATUS")}
                        </div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                          <span>
                            <i className="legend-dot bg-matched" />
                            {text("Matched")}
                          </span>
                          <span>
                            <i className="legend-dot bg-possible" />
                            {text("Possible")}
                          </span>
                          <span>
                            <i className="legend-dot border-2 border-modis" />
                            {text("MODIS-only")}
                          </span>
                          <span>
                            <i className="legend-dot border-2 border-viirs" />
                            {text("VIIRS-only")}
                          </span>
                        </div>
                        <div className="mt-3">
                          <i className="legend-dot border border-dashed border-anomaly" />
                          {text("Anomaly region (separate flag)")}
                        </div>
                      </div>
                    </details>
                    {selected && (
                      <div
                        role="region"
                        aria-label="Observation details"
                        className="observation-details"
                        tabIndex={-1}
                        ref={(node) => {
                          node?.focus();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setSelected(null);
                        }}
                      >
                        <button
                          aria-label="Close observation"
                          className="float-right"
                          onClick={() => setSelected(null)}
                        >
                          ✕
                        </button>
                        <b>
                          {selected.sensor} · {selected.status}
                        </b>
                        <p className="mt-3">
                          {selected.date} {selected.timeUtc} UTC
                        </p>
                        <p>
                          {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
                        </p>
                        <p>{selected.province}</p>
                        <p>
                          Confidence: {selected.confidence} (
                          {selected.sensor === "MODIS" ? "0–100" : "l/n/h"})
                        </p>
                        <p>FRP: {selected.frp ?? "unavailable"} MW</p>
                        <p>
                          {selected.satellite} · {selected.product}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {selected.file?.filename} · row {selected.source_row}
                        </p>
                        <p className="mt-2">{selected.candidates?.length} candidate links</p>
                        {selected.candidates?.map((c: any) => (
                          <div
                            className="mt-2 border-t border-border pt-2 text-xs"
                            key={c.modis_id + c.viirs_id}
                          >
                            {c.label} · score {c.score.toFixed(3)}
                            <br />
                            {c.distance_km.toFixed(3)} km · {c.dt_min.toFixed(1)} min
                            <br />
                            {c.assigned ? "Assigned" : "Alternative retained"}
                          </div>
                        ))}
                        {technical && (
                          <details className="mt-3">
                            <summary>{text("Original record and provenance")}</summary>
                            <pre className="overflow-auto text-[10px]">
                              {JSON.stringify(selected, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                  {technical && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {text(
                        "All selected records are included. Clusters expand as you zoom; no map pages or sampling. In Harmonized view each group appears once. Date ranges replace year/month filters.",
                      )}
                    </p>
                  )}
                </section>
              </>
            )}
            {page === "overview" && (
              <>
                <section id="overview" className="scroll-mt-32">
                  {summary?.total === 0 && (
                    <Notice title="No retained observations">
                      No source detections match these filters. Coverage is unknown; this does not
                      establish absence of fires.
                    </Notice>
                  )}
                  <div className="metric-grid">
                    {[
                      ["Source detections", summary?.total, ""],
                      ["MODIS", summary?.modis, "text-modis"],
                      ["VIIRS S-NPP", summary?.viirs, "text-viirs"],
                      ["Matched groups", summary?.matched, "text-matched"],
                      ["Possible groups", summary?.possible, "text-possible"],
                      ["MODIS-only", summary?.modis_only, "text-modis"],
                      ["VIIRS-only", summary?.viirs_only, "text-viirs"],
                      ["Activity groups + unmatched", summary?.activity, ""],
                    ]
                      .filter(
                        ([label]) =>
                          technical ||
                          [
                            "Source detections",
                            "MODIS",
                            "VIIRS S-NPP",
                            "Activity groups + unmatched",
                          ].includes(String(label)),
                      )
                      .map(([label, value, color]) => (
                        <div className="metric" key={String(label)}>
                          <div className="text-xs text-muted-foreground">{text(String(label))}</div>
                          <div className={"mt-3 font-mono text-2xl " + color}>
                            {fmt(value as number)}
                          </div>
                        </div>
                      ))}
                  </div>
                </section>
                <CriticalPeriods
                  region={region}
                  daynight={daynight}
                  detectionType={detectionType}
                  technical={technical}
                />
                <ActivityOverview
                  monthly={monthly}
                  technical={technical}
                  anomalies={
                    anomalies
                      ? {
                          ...anomalies,
                          year: analysisYear,
                          data: (anomalies?.data ?? []).filter(
                            (r: any) =>
                              (!month || r.month === Number(month)) &&
                              (!region || r.region === region) &&
                              (!startDate ||
                                `${analysisYear}-${String(r.month).padStart(2, "0")}` >=
                                  startDate.slice(0, 7)) &&
                              (!endDate ||
                                `${analysisYear}-${String(r.month).padStart(2, "0")}` <=
                                  endDate.slice(0, 7)),
                          ),
                        }
                      : null
                  }
                  label={
                    startDate || endDate
                      ? `${startDate || "2022-01-01"} to ${endDate || "2025-12-31"}`
                      : year
                        ? `${month ? MONTHS[Number(month) - 1] + " " : "All months · "}${year}`
                        : "2022–2025 cumulative selected activity"
                  }
                />
              </>
            )}
            {page === "sensors" && (
              <>
                <SensorHarmonization summary={summary} />
                <section id="source-metrics" className="panel scroll-mt-32 p-5">
                  <h3 className="mb-3 text-lg">
                    {text("FRP in selected period · original sensor values")}
                  </h3>
                  <table className="archive-table">
                    <thead>
                      <tr>
                        <th>{text("Sensor")}</th>
                        <th>{text("Available records")}</th>
                        <th>{text("Median MW")}</th>
                        <th>{text("Mean MW")}</th>
                        <th>{text("90th percentile MW")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["MODIS", "VIIRS"].map((sensor) => {
                        const f = summary?.frp_by_sensor?.[sensor];
                        return (
                          <tr key={sensor}>
                            <td>{sensor}</td>
                            <td>{fmt(f?.n)}</td>
                            <td>{fmt(f?.median)}</td>
                            <td>{fmt(f?.mean)}</td>
                            <td>{fmt(f?.p90)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mb-5 mt-2 text-xs text-muted-foreground">
                    {text(
                      "FRP is summarized separately per sensor and is not summed across matched observations as fire energy.",
                    )}
                  </p>
                  <h2 className="text-xl">
                    {t("nav_sensors")} · selected monthly activity, {year || "2022–2025"}
                  </h2>
                  <p className="my-2 text-xs text-muted-foreground">
                    {text(
                      "Chart follows the selected period and map filters. Counts are source detections, not equivalent sensor measurements.",
                    )}
                  </p>
                  <MonthlySensorChart monthly={monthly} />
                </section>
                <section className="panel p-5">
                  <div className="scope-tag">Archive-wide · filters above do not apply</div>
                  <h2 className="text-xl">{text("Matching evidence & threshold review")}</h2>
                  <p className="my-2 text-xs text-muted-foreground">
                    {text(
                      "All candidate links are preserved. Tables below cover the entire archive, independent of map filters. Scores are evidence rankings, not probabilities.",
                    )}
                  </p>
                  <table className="archive-table">
                    <thead>
                      <tr>
                        <th>{text("Distance gate")}</th>
                        <th>{text("Time gate")}</th>
                        <th>{text("Assigned groups")}</th>
                        <th>{text("Matched")}</th>
                        <th>{text("Possible")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sensitivity?.data.map((r: any) => (
                        <tr key={r.distance_km}>
                          <td>{r.distance_km} km</td>
                          <td>{r.time_minutes} min</td>
                          <td>{fmt(r.assigned_groups)}</td>
                          <td>{fmt(r.matched)}</td>
                          <td>{fmt(r.possible)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="my-2 text-xs text-muted-foreground">{sensitivity?.note}</p>
                  <details>
                    <summary>Review top 30 of {fmt(evidence?.total)} candidate pairs</summary>
                    <div className="max-h-[260px] overflow-auto">
                      <table className="archive-table">
                        <thead>
                          <tr>
                            <th>{text("Distance")}</th>
                            <th>{text("Time")}</th>
                            <th>{text("Score")}</th>
                            <th>{text("Status")}</th>
                            <th>{text("Assignment")}</th>
                            <th>{text("Provenance")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidence?.data.map((r: any) => (
                            <tr key={r.modis_id + r.viirs_id}>
                              <td>{r.distance_km.toFixed(3)} km</td>
                              <td>{r.dt_min.toFixed(1)} min</td>
                              <td>{r.score.toFixed(3)}</td>
                              <td>{r.label}</td>
                              <td>{text(r.assigned ? "Assigned" : "Alternative")}</td>
                              <td>
                                <button
                                  className="archive-button"
                                  onClick={async () => {
                                    try {
                                      await selectObservation(r.modis_id);
                                      goToMap();
                                    } catch (e) {
                                      setError(String(e));
                                    }
                                  }}
                                >
                                  {text("Inspect MODIS")}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </section>
              </>
            )}
            {page === "heatmap" && <ArchiveHeatmap query={mapQuery} light={light} />}
            {page === "calendar" && (
              <ArchiveCalendar
                scope={{
                  year: year || null,
                  month,
                  region,
                  daynight,
                  startDate,
                  endDate,
                  detectionType,
                }}
                onShowDay={(date) => {
                  setYear(0);
                  setMonth("");
                  setStartDate(date);
                  setEndDate(date);
                  goToMap();
                }}
              />
            )}
            {page === "history" && (
              <>
                <label className="history-region">
                  History location{" "}
                  <select value={historyRegion} onChange={(e) => setHistoryRegion(e.target.value)}>
                    <option value="">Indonesia · all regions</option>
                    {(meta?.regions ?? []).map((r: string) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <SituationShift
                  history={history}
                  regions={meta?.regions ?? []}
                  region={historyRegion}
                />
              </>
            )}
            {page === "anomalies" && (
              <>
                <section id="anomalies" className="panel scroll-mt-32 p-5">
                  <h2 className="text-xl">
                    {t("nav_anomalies")} · exploratory {anomalyYear}
                  </h2>
                  <p className="my-2 text-xs text-muted-foreground">
                    {technical && anomalies?.method} Coverage differences can create apparent
                    anomalies. These are not warnings.
                  </p>
                  <Notice title="How a region-month is flagged">
                    Compare activity units against the median of the same region and calendar month
                    in the other three archive years. A flag requires robust z ≥ 3.5 and at least 10
                    units. All three baseline values must exist; if MAD is zero the scale is max(1,
                    10% of the median). Coverage is unknown.
                  </Notice>
                  <ArchiveFilters
                    monthlyOnly
                    value={anomalyScope}
                    regions={[]}
                    onApply={(v) => {
                      setAnomalyYear(v.year);
                      setAnomalyMonth(v.month);
                    }}
                  />
                  <p className="my-3 text-sm">
                    Monthly comparisons across all regions, day and night. Map date filters do not
                    apply.
                  </p>
                  {!anomalyLoading && anomalies && visibleAnomalies.length === 0 && (
                    <p role="status">
                      No flagged anomalies for this period. This does not mean no activity. Missing
                      baseline data can prevent a comparison.
                    </p>
                  )}
                  {visibleAnomalies.length > 0 && (
                    <FlaggedChart rows={visibleAnomalies} months={MONTHS} />
                  )}
                  <div className="max-h-[280px] overflow-auto">
                    <table className="archive-table">
                      <thead>
                        <tr>
                          <th>{text("Region")}</th>
                          <th>{text("Month")}</th>
                          <th>{text("Observed")}</th>
                          <th>{text("Baseline median")}</th>
                          {technical && <th>{text("Robust z")}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAnomalies.map((r: any) => (
                          <tr key={r.region + r.month}>
                            <td>{r.region}</td>
                            <td>{MONTHS[r.month - 1]}</td>
                            <td>{fmt(r.observed)}</td>
                            <td>{fmt(r.median)}</td>
                            {technical && (
                              <td>
                                {r.z.toFixed(2)}
                                {r.fallback ? " (fallback)" : ""}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
            {page === "prediction" && (
              <>
                <section id="prediction" className="panel scroll-mt-32 p-5">
                  <p className="chart-caption">
                    Jan–Mar 2026 · experimental, not a current forecast.
                  </p>
                  <Notice title="Experimental · not a current forecast">
                    Jan–Mar 2026 estimates use observations ending in 2025. Error bounds use the
                    80th percentile of historical absolute errors; they are not an 80% prediction
                    interval or guaranteed coverage. Model selection and evaluation share backtest
                    windows.
                  </Notice>
                  <p className="my-2 text-xs text-muted-foreground">
                    {forecast?.limitations ?? forecast?.reason}
                  </p>
                  {forecast?.available && (
                    <>
                      {technical ? (
                        <p className="text-sm">
                          Model: {forecast.model} · MAE naive {fmt(forecast.mae.seasonal_naive)},
                          seasonal mean {fmt(forecast.mae.seasonal_mean)}. Expanding-window tests:
                          2024 and 2025.
                        </p>
                      ) : (
                        <p className="text-sm">
                          Predictions use past activity from the same month in earlier years. The
                          method with the smaller historical error is selected. The dashed lines
                          show uncertainty.
                        </p>
                      )}
                      <div className="mt-5 flex justify-between items-center gap-3">
                        <h3>{text("Forecast activity units · 2026")}</h3>
                        <button
                          className="archive-button"
                          aria-pressed={showGrid}
                          onClick={() => setShowGrid(!showGrid)}
                        >
                          {text(showGrid ? "Hide grid" : "Show grid")}
                        </button>
                      </div>
                      <OutlookChart outlook={forecast.outlook} months={MONTHS} grid={showGrid} />
                      <p className="text-xs text-muted-foreground">{forecast.interval}</p>
                      {technical && (
                        <details className="mt-3">
                          <summary>{text("Chronological backtest results")}</summary>
                          <table className="archive-table">
                            <thead>
                              <tr>
                                <th>{text("Period")}</th>
                                <th>{text("Actual")}</th>
                                <th>{text("Naive")}</th>
                                <th>{text("Seasonal mean")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {forecast.backtest.map((r: any) => (
                                <tr key={r.year + "-" + r.month}>
                                  <td>
                                    {r.year}-{r.month}
                                  </td>
                                  <td>{fmt(r.actual)}</td>
                                  <td>{fmt(r.seasonal_naive)}</td>
                                  <td>{fmt(r.seasonal_mean)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                    </>
                  )}
                </section>
              </>
            )}
            {page === "methodology" && (
              <>
                <section id="methodology" className="panel scroll-mt-32 p-5">
                  <p className="my-3">
                    Two satellites can observe related thermal activity. FIREWATCH keeps the
                    original detections, ranks nearby observations in time and space, and counts
                    each assigned pair once as a provisional activity unit. This does not establish
                    a confirmed fire or its perimeter.
                  </p>
                  <ReadingGuide />
                  <details className="method-section">
                    <summary>Matching eligibility, thresholds, and assignment</summary>
                    <p className="my-3 text-sm">
                      {text(
                        "All original rows are retained in SQLite with source SHA-256 and source row. Matching eligibility: MODIS confidence ≥30; VIIRS nominal/high; detection type 0. Other observations remain visible as unmatched. Spatial gate ≤1 km; time gate ≤30 min. Score = 0.6 × distance evidence + 0.4 × time evidence. Matched ≥0.70; possible ≥0.45. Maximum-weight one-to-one assignment is a documented MVP simplification; possible groups are counted once as provisional activity units, anchored on the MODIS acquisition date and region. Scores are not probabilities.",
                      )}
                    </p>
                  </details>
                  <details className="method-section">
                    <summary>Measurements, footprints, and product differences</summary>
                    <p className="mb-3 text-sm">
                      {text(
                        "Footprint IoU is unavailable because reliable pixel orientation is absent. Scan/track fields are retained for review. MODIS 2022 reports 6.03; later years report 61.03. Raw sensor counts and FRP are never treated as equivalent or summed into fire energy. Archive request membership is preserved; unassigned/offshore points are not silently deleted.",
                      )}
                    </p>
                  </details>
                  <details className="method-section">
                    <summary>Boundaries, basemaps, and provenance</summary>
                    <p className="text-xs text-muted-foreground">
                      {text(
                        "Boundaries: geoBoundaries gbOpen IDN ADM1, ODbL 1.0; province vintage may differ from current administrative divisions. Map tiles: Esri and OpenStreetMap contributors. Map uses spatial clusters; complete counts come from SQLite.",
                      )}
                    </p>
                  </details>
                  <details className="mt-3">
                    <summary>{text("Files, checksums and processing configuration")}</summary>
                    <pre className="mt-3 max-h-[300px] overflow-auto text-xs">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </details>
                </section>
              </>
            )}
            {page === "help" && (
              <section className="panel p-6 space-y-5">
                <h2 className="text-xl">{text("Help & reading the map")}</h2>
                <p>
                  {text(
                    "Choose Year, Month or Date range in Filters, then select Apply. Region and day/night can be combined with the period.",
                  )}
                </p>
                <p>
                  {text(
                    "Zoom to expand clusters. Hover for a short summary; click an individual detection for source details. Numbers count observations or activity units, not confirmed fires.",
                  )}
                </p>
                <p>
                  {text(
                    "MODIS and VIIRS have different resolutions and confidence scales. FRP means fire radiative power, measured in megawatts (MW); it is not temperature or a danger rating.",
                  )}
                </p>
                <p>
                  {text(
                    "Open the separate FRP heatmap to view mean source FRP per map cell, without hotspot dots. Hover a hotspot on the main map to outline its approximate observation extent; this is not a fire boundary. Scan/track sizes lack pixel orientation. Outlines are hidden when the data cannot define an area.",
                  )}
                </p>
                <p>
                  {text(
                    "If loading fails, retry the page and check that the archive API is running. Basemap tiles need internet access. Missing detections do not prove zero activity.",
                  )}
                </p>
                <Link className="archive-button inline-block" to="/$page" params={{ page: "map" }}>
                  {text("Return to map")}
                </Link>
              </section>
            )}
          </Suspense>
          <footer className="py-6 text-center text-xs text-muted-foreground">
            {text(
              "FIREWATCH · Satellite thermal observations are not confirmed incidents. Historical archive only.",
            )}
            <a href={API + "/docs"}>{text("API documentation")}</a>
          </footer>
        </div>
      </main>
    </div>
  );
}
