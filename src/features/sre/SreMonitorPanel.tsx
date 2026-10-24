import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LeftPanelProps } from '../../components/leftPanels';
import type { SreMonitorState } from '../../api/types';
import { fetchCircuitRoute } from '../../api/client';
import type { CircuitRoute } from '../../api/types';
import { DetailCard, Gauge, StatCard, LineChart, PanelPagination } from '@aicoe/aihub-platform/ui';
import CityMap from '../../components/CityMap';
import InfoCanvasPlaceholder from '../../components/InfoCanvasPlaceholder';
import AiAnalysisNote from '../../components/AiAnalysisNote';

// Fixed status palette (never themed) — see mcp-server's thresholds in
// agent_backend/agents/sre_monitor/prompt.md, which these mirror exactly.
const STATUS_GOOD = '#0ca30c';
const STATUS_WARNING = '#fab219';
const STATUS_CRITICAL = '#d03b3b';
// Gauge/StatCard's "nothing selected yet" placeholder state — distinct
// from STATUS_GOOD/WARNING/CRITICAL, which all mean telemetry actually
// came back with a reading. Matches --text-muted's approximate value
// (this panel's status colors are all fixed, never themed, same as the
// three above).
const STATUS_NEUTRAL = '#9ca3af';

// Where the gauge's colored zones change — the "Normal"/"Above Normal"
// TEXT label is still governed by UTIL_THRESHOLD alone (2-tier, matching
// the prompt's threshold rule), but the gauge's fill/track color is a
// finer 3-tier read (green/yellow/red) so the visual gives an earlier
// warning than the pass/fail label does on its own.
const UTIL_MID = 50;
const UTIL_THRESHOLD = 80;
const JITTER_THRESHOLD_MS = 30;

// The map now sits full-width above the detail card (rather than
// shrink-wrapped beside it), and this panel's width genuinely varies —
// the left/right split defaults to 30:70 but is user-draggable — so a
// single fixed pixel size (like the Service Reliability Agent's map,
// tuned for its own 50%-default panel) would either leave dead space or
// overflow depending on both the split and the window. MAP_CARD_PADDING
// mirrors .city-map-card's own CSS padding (0.75rem each side) — the
// pixel width handed to CityMap must exclude it, since that's the actual
// tile canvas size, not the card's outer box.
const MAP_HEIGHT = 200;
const MAP_CARD_PADDING = 24;
const INITIAL_MAP_WIDTH = 360;

function utilizationColor(percent: number): string {
  if (percent >= UTIL_THRESHOLD) return STATUS_CRITICAL;
  if (percent >= UTIL_MID) return STATUS_WARNING;
  return STATUS_GOOD;
}

// Takes `t` as a parameter rather than calling useTranslation() itself —
// this is a plain function, not a component, so it can't use hooks; the
// caller (the component below) already has `t` from its own hook call.
function utilizationStatus(percent: number, t: TFunction): { label: string; color: string } {
  return {
    label: percent > UTIL_THRESHOLD ? t('sreMonitor.aboveNormal') : t('sreMonitor.normal'),
    color: utilizationColor(percent),
  };
}

function jitterStatus(ms: number, t: TFunction): { label: string; color: string } {
  // 2-tier, not 3: Normal below the threshold, Elevated at/above it — no
  // middle "Elevated 2-30ms" band anymore (that made a perfectly typical
  // ~6ms reading read as a problem).
  if (ms >= JITTER_THRESHOLD_MS) return { label: t('sreMonitor.elevated'), color: STATUS_CRITICAL };
  return { label: t('sreMonitor.normal'), color: STATUS_GOOD };
}

function formatPercent(percent: number): string {
  const rounded = Math.round(percent * 100) / 100;
  if (percent > 0 && rounded === 0) return '<0.01%';
  return `${rounded.toFixed(2)}%`;
}

// This agent's left panel: refreshes to whichever circuit the user most
// recently asked about in the chat (see ChatPage's toolResults
// state). Renders the full template (map, detail card, gauge, charts,
// jitter) from the moment this panel first appears — i.e. as soon as
// list_active_circuits has been called, which is what switches
// UnifiedLeftPanel to this panel in the first place — rather than a bare
// "select a circuit" message until telemetry exists. Every field/value
// below falls back to a neutral placeholder ("—", a zeroed gauge, a
// generic world map) until the real data for it arrives, so the layout
// itself never jumps/reflows once it does — only the placeholders get
// replaced in place.
export default function SreMonitorPanel({ toolResults, selectedCircuitReference }: LeftPanelProps) {
  const { t } = useTranslation();
  const state = toolResults as SreMonitorState;
  const telemetryResult = state.get_circuit_telemetry;
  const circuitReference =
    selectedCircuitReference ??
    state.present_time_period_options?.circuit_reference ??
    telemetryResult?.circuit_reference;
  const telemetry =
    telemetryResult?.circuit_reference === circuitReference ? telemetryResult : undefined;
  const [page, setPage] = useState(0);
  const labels = telemetry
    ? [t('sreMonitor.pages.overview'), t('sreMonitor.pages.metrics')]
    : [t('sreMonitor.pages.overview')];
  const activePage = Math.min(page, labels.length - 1);
  const [lastTelemetry, setLastTelemetry] = useState<typeof telemetry>(undefined);

  // Fetched independently of chat/toolResults entirely — the panel
  // already knows which circuit is on screen, so it asks the naas-mcp
  // agent-backend's plain REST endpoint (GET /circuits/{ref}/route)
  // directly rather than the agent needing to surface this itself.
  // Purely supplementary: if it fails (e.g. this circuit's ports don't
  // resolve to a known location), the map is just omitted — never an
  // error banner over real telemetry.
  const [route, setRoute] = useState<CircuitRoute | null>(null);
  // Tracked separately from `route` so the loading placeholder (see
  // CityMapLoading) can occupy the map's slot in the row from the very
  // first render — without it, the detail card briefly sits alone at
  // full row width, then jumps to its narrower side-by-side width the
  // moment the map data arrives a beat later.
  // Loading is toggled true synchronously in the render-phase reset below
  // (and seeded here for the initial mount) rather than inside the effect,
  // which would trip react-hooks/set-state-in-effect; the effect only ever
  // clears it, from inside its async callback.
  const [routeLoading, setRouteLoading] = useState(Boolean(circuitReference));

  // Measures the map row's actual rendered width so the tile canvas
  // (CityMap does its own pixel-based tile math, not CSS-responsive) fills
  // it exactly instead of a fixed guess — recomputes live as the left
  // panel is dragged wider/narrower, not just once on mount.
  const mapRowRef = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState(INITIAL_MAP_WIDTH);

  useEffect(() => {
    const el = mapRowRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setMapWidth(Math.max(0, Math.round(width) - MAP_CARD_PADDING));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Clear the stale route the moment the target circuit changes. Done as a
  // render-phase state adjustment (the React-sanctioned pattern for
  // "reset state when an input changes") rather than inside the effect
  // below, which trips react-hooks/set-state-in-effect.
  const [lastCircuitReference, setLastCircuitReference] = useState(circuitReference);
  if (circuitReference !== lastCircuitReference) {
    setLastCircuitReference(circuitReference);
    setRoute(null);
    setRouteLoading(Boolean(circuitReference));
    setPage(0);
  }

  // Once fresh telemetry for the selected circuit arrives (after a time
  // period is chosen), take the user directly to its metrics page. Kept
  // as a render-phase adjustment so this state transition doesn't need an
  // effect-triggered extra render.
  if (telemetry !== lastTelemetry) {
    setLastTelemetry(telemetry);
    if (telemetry && telemetry.circuit_reference === circuitReference) setPage(1);
  }

  useEffect(() => {
    if (!circuitReference) {
      return;
    }
    let cancelled = false;
    fetchCircuitRoute(circuitReference)
      .then((result) => {
        if (!cancelled) setRoute(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [circuitReference]);

  const circuit = circuitReference
    ? state.list_active_circuits?.circuits.find((c) => c.circuit_reference === circuitReference)
    : undefined;

  const util = telemetry?.bandwidth_utilization;
  const jitter = telemetry?.jitter;

  const utilPercent = util?.available && util.percent !== undefined ? util.percent : null;
  const utilStatus = utilPercent !== null ? utilizationStatus(utilPercent, t) : null;

  const jitterMs = jitter?.available && jitter.value_ms !== undefined ? jitter.value_ms : null;
  const jStatus = jitterMs !== null ? jitterStatus(jitterMs, t) : null;

  return (
    <div className="sre-monitor-panel">
      <PanelPagination page={activePage} labels={labels} onChange={setPage} />
      {activePage === 0 && <>
      <div className="sre-monitor-map-row" ref={mapRowRef}>
        {(routeLoading || route) && (
          <CityMap
            from={route?.from}
            to={route?.to}
            width={mapWidth}
            height={MAP_HEIGHT}
            showWithoutPoints
            loading={routeLoading}
          />
        )}
        {/* No circuit picked yet (or its route failed to resolve) — the
            shared Info Canvas placeholder fills the same slot instead of
            leaving it blank, same convention as the Service Reliability
            Agent's map before a Reliability Rule exists. Sized to the map
            it stands in for, so the row never reflows once a real route
            arrives. */}
        {!routeLoading && !route && (
          <InfoCanvasPlaceholder width={mapWidth} height={MAP_HEIGHT} />
        )}
      </div>

      <DetailCard
        title={circuit?.name ?? circuitReference ?? t('sreMonitor.noCircuitSelected')}
        rows={[
          { label: t('sreMonitor.fields.circuitReference'), value: circuitReference ?? '—' },
          { label: t('sreMonitor.fields.ocn'), value: circuit?.ocn ?? '—' },
          {
            label: t('sreMonitor.fields.currentBandwidth'),
            value: circuit?.bandwidth_mbps != null ? `${circuit.bandwidth_mbps} Mbps` : '—',
          },
          {
            label: t('sreMonitor.fields.baseBandwidth'),
            value: circuit?.base_bandwidth_mbps != null ? `${circuit.base_bandwidth_mbps} Mbps` : '—',
          },
          { label: t('sreMonitor.fields.connectionType'), value: circuit?.connection_type ?? '—' },
          { label: t('sreMonitor.fields.resiliency'), value: circuit?.resiliency ?? '—' },
          { label: t('sreMonitor.fields.status'), value: circuit?.status ?? '—' },
        ]}
      />

      </>}

      {activePage === 1 && <>
      {utilPercent !== null && utilStatus ? (
        <Gauge
          value={utilPercent}
          displayValue={formatPercent(utilPercent)}
          label={t('sreMonitor.bandwidthUtilization')}
          statusColor={utilStatus.color}
          statusLabel={utilStatus.label}
          thresholdPercent={UTIL_THRESHOLD}
          zones={[
            { upTo: UTIL_MID, color: STATUS_GOOD },
            { upTo: UTIL_THRESHOLD, color: STATUS_WARNING },
            { upTo: 100, color: STATUS_CRITICAL },
          ]}
        />
      ) : telemetry ? (
        <div className="sre-monitor-unavailable">{t('sreMonitor.bandwidthUtilizationUnavailable')}</div>
      ) : (
        <Gauge
          value={0}
          displayValue="—"
          label={t('sreMonitor.bandwidthUtilization')}
          statusColor={STATUS_NEUTRAL}
          statusLabel="—"
          thresholdPercent={UTIL_THRESHOLD}
          zones={[
            { upTo: UTIL_MID, color: STATUS_GOOD },
            { upTo: UTIL_THRESHOLD, color: STATUS_WARNING },
            { upTo: 100, color: STATUS_CRITICAL },
          ]}
        />
      )}

      {/* Only the three duration periods carry a time series — "current"
          is a single live reading with nothing to plot, same as before
          any telemetry has been fetched at all. LineChart already renders
          its own "No data available" placeholder for an empty array, so
          this always renders rather than being gated on data_points
          existing — no separate empty-state markup needed here. */}
      <LineChart
        title={t('sreMonitor.utilizationTrend')}
        dataPoints={util?.data_points ?? []}
        unitSuffix="%"
        yDomain={[0, 100]}
      />

      {/* Separately LLM-generated (agent-backend's core/telemetry_analysis.py),
          not part of the agent's own chat reply — a short read on the
          utilization numbers/chart directly above. Kept separate from the
          jitter one below (rather than one combined blurb), each sitting
          under its own chart. Omitted entirely if that generation call
          didn't produce anything (e.g. utilization was unavailable),
          rather than showing an empty card. */}
      <AiAnalysisNote text={state.ai_analysis_utilization} />

      {jitterMs !== null && jStatus ? (
        <StatCard
          label={t('sreMonitor.jitter')}
          value={`${jitterMs.toFixed(2)} ms`}
          statusColor={jStatus.color}
          statusLabel={jStatus.label}
        />
      ) : telemetry ? (
        <div className="sre-monitor-unavailable">{t('sreMonitor.jitterUnavailable')}</div>
      ) : (
        <StatCard label={t('sreMonitor.jitter')} value="—" />
      )}

      <LineChart title={t('sreMonitor.jitterTrend')} dataPoints={jitter?.data_points ?? []} unitSuffix=" ms" />

      <AiAnalysisNote text={state.ai_analysis_jitter} />
      </>}
    </div>
  );
}
