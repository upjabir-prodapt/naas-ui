import { useEffect, useRef, useState } from 'react';
import { Menu, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  fetchCircuitRoute,
  fetchDemoCircuit,
  fetchReliabilityAuditLog,
  fetchReliabilityEvents,
  fetchReliabilityRules,
  simulateUtilizationHigh,
  simulateUtilizationLow,
} from '../../api/client';
import type {
  CircuitRoute,
  DemoCircuit,
  ReliabilityAuditEntry,
  ReliabilityEvent,
  ReliabilityRule,
} from '../../api/types';
import { useQuota } from '@aicoe/aihub-platform/quota';
import CityMap, { CityMapLoading } from '../../components/CityMap';
import { DetailCard, PanelPagination } from '@aicoe/aihub-platform/ui';
import InfoCanvasPlaceholder from '../../components/InfoCanvasPlaceholder';

// Polls the naas-mcp agent-backend's /reliability/* endpoints directly —
// independent of chat/toolResults entirely — so pressing a Simulate
// button and watching the background poller (reliability_poller.py) pick
// it up, act on it, and write an audit row is visible here without
// needing to ask the chat agent anything. Matches AdminPage.tsx's
// own-state-plus-fetch pattern rather than the other panels' toolResults-
// derived rendering, since this data isn't produced by a chat turn at all.
// WAS 4000, RAISED 2026-09-29 AFTER AN INCIDENT. At 4s this fired all four
// fetches every tick — 60 requests/minute from one open panel, which is
// exactly Apigee's per-user per-minute ceiling, and 290 of one user's 300
// daily NaaS requests inside five minutes. They were then locked out of chat
// having sent 32 messages. The backend poller this mirrors ticks every 7s, so
// 20s still shows an event within roughly one poller cycle of it landing.
const REFRESH_INTERVAL_MS = 20000;
// Rules and the audit log change only when the poller acts on an event, so
// they do not need refreshing as often as the circuit and event list.
const SLOW_REFRESH_EVERY_N_TICKS = 3;
// Back off on sustained failure rather than hammering a struggling backend.
const MAX_BACKOFF_MS = 5 * 60 * 1000;

// The full-width map is sized from its container with ResizeObserver,
// since the left/right panel split can be dragged by the user.
const MAP_HEIGHT = 220;
const MAP_CARD_PADDING = 24;

function eventStatusClass(status: ReliabilityEvent['status']): string {
  switch (status) {
    case 'PENDING':
      return 'scl-badge scl-badge--pending';
    case 'CLAIMED':
      return 'scl-badge scl-badge--claimed';
    case 'PROCESSED':
      return 'scl-badge scl-badge--good';
    case 'IGNORED':
      return 'scl-badge scl-badge--neutral';
    default:
      return 'scl-badge';
  }
}

function auditStatusClass(status: ReliabilityAuditEntry['status']): string {
  if (status === 'COMPLETED') return 'scl-badge scl-badge--good';
  if (status === 'FAILED') return 'scl-badge scl-badge--bad';
  // TIMED_OUT (and SUBMITTED) mean "Colt hadn't confirmed completion
  // within our wait window" — not "this failed". The underlying boost
  // may still land; the reliability poller keeps re-checking and flips
  // this to COMPLETED on its own once Colt confirms (see
  // reliability_poller.py's _reconcile_unresolved). Styled distinctly
  // from FAILED so it doesn't read as a confirmed error.
  return 'scl-badge scl-badge--pending';
}

function formatMbps(value: number | null): string {
  return value != null ? `${value} Mbps` : '—';
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

// Takes no props — unlike ServiceOrderPanel/SreMonitorPanel, this panel
// polls the naas-mcp agent-backend's own /reliability/* endpoints directly
// rather than deriving anything from chat tool_results. Still assignable
// to ComponentType<LeftPanelProps> (leftPanels.tsx) since a component that
// ignores its props needs no parameter at all.
export default function SreClosedLoopPanel() {
  const { t } = useTranslation();
  const [demoCircuit, setDemoCircuit] = useState<DemoCircuit | null>(null);
  const [events, setEvents] = useState<ReliabilityEvent[]>([]);
  const [auditLog, setAuditLog] = useState<ReliabilityAuditEntry[]>([]);
  const [rules, setRules] = useState<ReliabilityRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<'high' | 'low' | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [page, setPage] = useState(0);
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  // Read through a ref: the polling effect mounts once with empty deps, and
  // re-subscribing it on every quota change would restart the timer.
  const quotaExhausted = useQuota().isExhausted('naas');
  const quotaExhaustedRef = useRef(quotaExhausted);
  useEffect(() => {
    quotaExhaustedRef.current = quotaExhausted;
  }, [quotaExhausted]);
  // Prevents onMouseLeave (fired the instant the pointer crosses into the
  // popup, since it's a separate element from the button) from closing
  // the popup before it ever registers the pointer entering it — both
  // the button and the popup share this one open/close pair instead.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const element = mapAreaRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setMapWidth(Math.max(0, Math.round(width) - MAP_CARD_PADDING));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function openSimulate() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setSimulateOpen(true);
  }

  function scheduleCloseSimulate() {
    closeTimerRef.current = setTimeout(() => setSimulateOpen(false), 120);
  }

  // Same route-map fetch as the Service Observability Agent's panel
  // (fetchCircuitRoute/CityMap are the exact same components, reused
  // as-is), just keyed off demoCircuit's circuit_reference instead of a
  // chat turn's telemetry — demoCircuit already tracks "whichever
  // circuit's rule was created most recently" (see reliability.py's
  // _latest_rule), which is exactly the circuit Simulate acts on.
  const circuitReference = demoCircuit?.circuit_reference ?? null;
  const [route, setRoute] = useState<CircuitRoute | null>(null);
  // Loading is toggled true synchronously in the render-phase reset below
  // (and seeded here for the initial mount) rather than inside the effect,
  // which would trip react-hooks/set-state-in-effect; the effect only ever
  // clears it, from inside its async callback.
  const [routeLoading, setRouteLoading] = useState(circuitReference !== null);

  // Clear the stale route the moment the target circuit changes. Done as a
  // render-phase state adjustment (the React-sanctioned pattern for
  // "reset state when an input changes") rather than inside the effect
  // below, which trips react-hooks/set-state-in-effect.
  const [lastCircuitReference, setLastCircuitReference] = useState(circuitReference);
  if (circuitReference !== lastCircuitReference) {
    setLastCircuitReference(circuitReference);
    setRoute(null);
    setRouteLoading(circuitReference !== null);
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

  function refetch(includeSlow?: boolean) {
    // Re-fetched on every cycle, not just on mount — the target circuit
    // is whichever rule was created most recently (see reliability.py's
    // _simulation_target), so it can change the moment a rule is created
    // via either agent's chat, with no explicit signal from that
    // conversation back to this panel.
    //
    // Deliberately silent on failure (unlike handleSimulate below) — this
    // fires on an interval in the background, not from a user action, so
    // a transient blip (or the backend restarting) shouldn't pop a red
    // banner over data that's a moment away from refreshing correctly on
    // its own. Same convention as the other two agents' left panels never
    // surfacing a transient background-refresh error. The panel just
    // keeps showing its last-known-good values until the next successful
    // cycle.
    // Returns whether anything succeeded, so the caller can back off when the
    // backend is consistently refusing. Still silent per-call, per the note
    // above; allSettled just means a total failure is now observable.
    const slow = includeSlow ?? true;
    const calls = [
      fetchDemoCircuit().then(setDemoCircuit),
      fetchReliabilityEvents().then(setEvents),
      ...(slow
        ? [
            fetchReliabilityAuditLog().then(setAuditLog),
            fetchReliabilityRules().then(setRules),
          ]
        : []),
    ];
    return Promise.allSettled(calls).then((results) =>
      results.some((r) => r.status === 'fulfilled'),
    );
  }

  useEffect(() => {
    // Not a bare setInterval any more. Three things changed, each for its own
    // reason: the tab must stop polling when nobody is looking at it, a
    // consistently failing backend must not be hammered, and an exhausted
    // quota must not be spent further by a background refresh.
    let cancelled = false;
    let timer: number | undefined;
    let tick = 0;
    let backoff = 0;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible' || quotaExhaustedRef.current) {
        // Skip the work but keep the loop alive, so it resumes by itself.
        schedule(REFRESH_INTERVAL_MS);
        return;
      }
      tick += 1;
      const ok = await refetch(tick % SLOW_REFRESH_EVERY_N_TICKS === 1);
      if (cancelled) return;
      backoff = ok ? 0 : Math.min(backoff === 0 ? REFRESH_INTERVAL_MS * 2 : backoff * 2, MAX_BACKOFF_MS);
      schedule(backoff || REFRESH_INTERVAL_MS);
    };

    // Refresh immediately on return rather than waiting out the interval.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      window.clearTimeout(timer);
      backoff = 0;
      void run();
    };

    void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function handleSimulate(kind: 'high' | 'low') {
    setSimulating(kind);
    setError(null);
    try {
      await (kind === 'high' ? simulateUtilizationHigh() : simulateUtilizationLow());
      setPage(1);
      refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSimulating(null);
    }
  }

  const hasTarget = demoCircuit?.circuit_reference != null;
  const labels = [t('sreClosedLoop.pages.overview'), t('sreClosedLoop.pages.eventsAndAuditLog')];
  const activePage = Math.min(page, labels.length - 1);
  const activeRule = rules.find((rule) => rule.circuit_reference === demoCircuit?.circuit_reference);

  function renderSimulateMenu() {
    return (
      <div className="scl-hamburger-wrap" onMouseEnter={openSimulate} onMouseLeave={scheduleCloseSimulate}>
        <button
          type="button"
          className="scl-hamburger-btn"
          aria-label={t('sreClosedLoop.simulateAria')}
          aria-haspopup="true"
          aria-expanded={simulateOpen}
          onClick={() => (simulateOpen ? setSimulateOpen(false) : openSimulate())}
        >
          <Menu size={18} />
        </button>
        {simulateOpen && (
          <div className="scl-simulate-popup">
            <div className="scl-simulate-popup-title">{t('sreClosedLoop.simulation')}</div>
            {hasTarget ? (
              <p className="scl-demo-circuit"><strong>{demoCircuit?.name}</strong>{' '}
                <span className="scl-muted">({demoCircuit?.circuit_reference})</span>
              </p>
            ) : <p className="scl-demo-circuit scl-muted">{t('emptyStates.noRuleSetYet')}</p>}
            <div className="scl-simulate-buttons">
              <button className="scl-btn scl-btn--high" disabled={simulating !== null || !hasTarget} onClick={() => handleSimulate('high')}>
                <TrendingUp size={14} />
                {simulating === 'high' ? t('sreClosedLoop.submitting') : t('sreClosedLoop.highUtilization')}
              </button>
              <button className="scl-btn scl-btn--low" disabled={simulating !== null || !hasTarget} onClick={() => handleSimulate('low')}>
                <TrendingDown size={14} />
                {simulating === 'low' ? t('sreClosedLoop.submitting') : t('sreClosedLoop.lowUtilization')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="scl-panel">
      {error && <p className="scl-error">{error}</p>}
      <div className="scl-history-toolbar">
        {renderSimulateMenu()}
        <PanelPagination page={activePage} labels={labels} onChange={setPage} />
      </div>
      {activePage === 0 && <>
      {/* The map fills its measured row. It shows the shared placeholder
          until a Reliability Rule exists, then the route for the circuit
          whose rule is most recent (also the Simulate target). */}
      <div className="scl-map-area" ref={mapAreaRef}>
        {(routeLoading || mapWidth === null) && <CityMapLoading width={mapWidth ?? undefined} height={MAP_HEIGHT} />}
        {!routeLoading && mapWidth !== null && hasTarget && route && (
          <CityMap from={route.from} to={route.to} width={mapWidth} height={MAP_HEIGHT} />
        )}
        {!routeLoading && mapWidth !== null && !hasTarget && (
          <InfoCanvasPlaceholder width={mapWidth} height={MAP_HEIGHT} />
        )}
      </div>
      {activeRule && (
        <DetailCard
          title={t('sreClosedLoop.ruleDetailTitle', { circuitName: demoCircuit?.name ?? activeRule.circuit_reference })}
          rows={[
            { label: t('common.circuitReference'), value: activeRule.circuit_reference },
            { label: t('sreMonitor.fields.status'), value: activeRule.status },
            { label: t('sreMonitor.fields.baseBandwidth'), value: formatMbps(activeRule.base_bandwidth_mbps) },
            { label: t('sreMonitor.fields.currentBandwidth'), value: formatMbps(activeRule.current_bandwidth_mbps) },
            { label: t('common.bandwidth'), value: formatMbps(activeRule.next_bandwidth_mbps) },
          ]}
        />
      )}
      </>}
      {activePage === 1 && <>
      <div className="scl-card">
        <div className="scl-card-title">{t('sreClosedLoop.recentEvents')}</div>
        <div className="scl-table-wrap">
          <table className="scl-table">
            <thead>
              <tr>
                <th>{t('common.circuitReference')}</th>
                <th>{t('common.type')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.created')}</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="scl-empty">
                    {t('emptyStates.noEventsYet')}
                  </td>
                </tr>
              )}
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.circuit_reference}</td>
                  <td>
                    {event.event_type === 'UTILIZATION_HIGH'
                      ? t('sreClosedLoop.highUtilization')
                      : t('sreClosedLoop.lowUtilization')}
                  </td>
                  <td>
                    <span className={eventStatusClass(event.status)}>{event.status}</span>
                  </td>
                  <td>{formatTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="scl-card">
        <div className="scl-card-title">{t('sreClosedLoop.auditLog')}</div>
        <div className="scl-table-wrap">
          <table className="scl-table">
            <thead>
              <tr>
                <th>{t('common.circuitReference')}</th>
                <th>{t('common.action')}</th>
                <th>{t('common.bandwidth')}</th>
                <th>{t('common.rentalCharge')}</th>
                <th>{t('sreClosedLoop.trigger')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.timestamp')}</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 && (
                <tr>
                  <td colSpan={7} className="scl-empty">
                    {t('emptyStates.noActionsLogged')}
                  </td>
                </tr>
              )}
              {auditLog.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.circuit_reference}</td>
                  <td>{entry.action}</td>
                  <td>
                    {formatMbps(entry.previous_bandwidth_mbps)} → {formatMbps(entry.new_bandwidth_mbps)}
                  </td>
                  <td>{entry.rental_charge ?? t('common.notAvailable')}</td>
                  <td>
                    {entry.triggered_by === 'MONITORING_EVENT' ? t('common.automatic') : t('common.manual')}
                  </td>
                  <td>
                    <span className={auditStatusClass(entry.status)}>{entry.status}</span>
                  </td>
                  <td>{formatTimestamp(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </div>
  );
}
