import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LeftPanelProps } from '../../components/leftPanels';
import type { CircuitRoute, ServiceConfigState } from '../../api/types';
import { fetchCircuitRoute } from '../../api/client';
import { DetailCard, Gauge, StatCard, PanelPagination } from '@aicoe/aihub-platform/ui';
import CityMap, { CityMapLoading } from '../../components/CityMap';
import InfoCanvasPlaceholder from '../../components/InfoCanvasPlaceholder';

// Overview (map + identity), Configuration (VLAN + billing), and Insights
// (AI review + performance) — a natural 3-way split of this panel's
// existing content, not new sections invented for pagination.
// PanelPagination derives its own page count from its labels array.

// Fixed status palette (never themed) — same thresholds/colors as
// SreMonitorPanel.tsx, kept as a separate local copy rather than a shared
// import since each panel already does this independently.
const STATUS_GOOD = '#0ca30c';
const STATUS_WARNING = '#fab219';
const STATUS_CRITICAL = '#d03b3b';
const STATUS_NEUTRAL = '#9ca3af';
const UTIL_MID = 50;
const UTIL_THRESHOLD = 80;
const JITTER_THRESHOLD_MS = 30;

const MAP_HEIGHT = 200;
const MAP_CARD_PADDING = 24;

// Fields update_connection_configuration (agent-backend/src/agents/
// catalog/service_config/tools.py) is allowed to change — mirrored here
// only to know which base-object key a given `field` name overrides when
// rendering, not re-validated on this side (the backend tool already
// rejects anything else).
type EditableField =
  | 'name'
  | 'description'
  | 'vlan_id'
  | 'vlan_type'
  | 'vlan_mapping'
  | 'commitment_period';

// Renders get_connection_details's commitment_expiry (an ISO datetime) as
// just the date portion — the time-of-day has no meaning here (Colt
// returns a fixed 23:59:59-style cutoff), so showing it just adds noise.
function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.split('T')[0] ?? iso;
}

// AI Config Review — same "short LLM-written note" pattern as
// AiAnalysisNote, styled separately here since this card renders bullet
// points rather than a single paragraph. Renders nothing while `text` is
// absent, which is currently always: no backend produces ai_config_review
// yet (see ServiceConfigState in ../types/naas).
function AiConfigReviewNote({ text }: { text?: string }) {
  const { t } = useTranslation();
  if (!text) return null;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => line.startsWith('- '));
  const isBulletList = bulletLines.length > 0 && bulletLines.length === lines.length;
  return (
    <div className="service-config-ai-review">
      <div className="service-config-ai-review-title">
        <Sparkles size={15} />
        {t('serviceConfig.aiConfigReview')}
      </div>
      {isBulletList ? (
        <ul>
          {lines.map((line, index) => (
            <li key={index}>{line.replace(/^- /, '')}</li>
          ))}
        </ul>
      ) : (
        <p>{text}</p>
      )}
    </div>
  );
}

function utilizationColor(percent: number): string {
  if (percent >= UTIL_THRESHOLD) return STATUS_CRITICAL;
  if (percent >= UTIL_MID) return STATUS_WARNING;
  return STATUS_GOOD;
}

// This agent's left panel: refreshes to whichever circuit the user most
// recently asked about, same convention as SreMonitorPanel.tsx. Shows the
// shared placeholder (see the early return below) until
// get_connection_details has actually returned something; once it has,
// renders the full template, with individual fields within it still
// falling back to neutral placeholders until their own data arrives.
//
// "Editing" a field (update_connection_configuration) never touches the
// base get_connection_details object — this panel overlays the edit on
// top of it at render time via `editedFields`, reset whenever the
// selected circuit changes so a previous circuit's edits never bleed
// into a new one.
export default function ServiceConfigPanel({ toolResults }: LeftPanelProps) {
  const { t } = useTranslation();
  const state = toolResults as ServiceConfigState;
  const details = state.get_connection_details;
  const hasDetails = Boolean(details);
  const telemetry = state.get_circuit_telemetry;
  const circuitReference = details?.circuit_reference;
  const connectionId = details?.connection_id;

  const [route, setRoute] = useState<CircuitRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Demo-only, in-conversation "edits" — never written back to
  // get_connection_details itself, just overlaid on top of it here.
  const [editedFields, setEditedFields] = useState<Partial<Record<EditableField, string>>>({});
  // Also resets the page back to the overview whenever the target
  // connection itself changes (not on every detail refresh for the SAME
  // connection), so switching circuits doesn't leave the user stranded
  // on, say, page 3 with no identity card in view.
  const [page, setPage] = useState(0);

  // Done as a render-phase state adjustment (the React-sanctioned pattern
  // for "reset state when an input changes") rather than inside an effect,
  // which trips react-hooks/set-state-in-effect — same approach as
  // SreMonitorPanel.tsx's own route reset.
  const [lastConnectionId, setLastConnectionId] = useState(connectionId);
  if (connectionId !== lastConnectionId) {
    setLastConnectionId(connectionId);
    setEditedFields({});
    setPage(0);
  }

  const mapRowRef = useRef<HTMLDivElement>(null);
  // Wait for the row's real width before drawing tiles. Starting with an
  // arbitrary width can leave the first map squarish until it is remounted.
  const [mapWidth, setMapWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = mapRowRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setMapWidth(Math.max(0, Math.round(width) - MAP_CARD_PADDING));
    });
    observer.observe(el);
    return () => observer.disconnect();
    // Depends on `page` because this row only exists in the DOM on page 0
    // — navigating away and back needs a fresh observer on the new
    // element.
  }, [page, hasDetails]);

  // Clear the stale route the moment the target circuit changes — same
  // render-phase adjustment as above, mirroring SreMonitorPanel.tsx.
  const [lastCircuitReference, setLastCircuitReference] = useState(circuitReference);
  if (circuitReference !== lastCircuitReference) {
    setLastCircuitReference(circuitReference);
    setRoute(null);
    setRouteLoading(Boolean(circuitReference));
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

  // Fold a new update_connection_configuration result into the display
  // overlay. Compared by object identity (not by field/value) — a new
  // call always produces a new object, even one that happens to repeat
  // the same field and value, which is exactly what should re-apply it.
  // Render-phase adjustment again, for the same lint/pattern reason as
  // the two resets above; it runs after them, so an edit that arrives in
  // the same turn as a new connection lands on the freshly cleared
  // overlay rather than being wiped by it.
  const update = state.update_connection_configuration;
  const [lastUpdate, setLastUpdate] = useState(update);
  if (update !== lastUpdate) {
    setLastUpdate(update);
    if (update?.updated && update.field && update.connection_id === connectionId) {
      setEditedFields((prev) => ({
        ...prev,
        [update.field as EditableField]: update.new_value ?? '',
      }));
    }
  }

  function displayField(field: EditableField, fallback: string | number | null | undefined): string {
    if (editedFields[field] !== undefined) return editedFields[field] as string;
    return fallback != null && fallback !== '' ? String(fallback) : t('serviceConfig.notSet');
  }

  // The identity card's title reflects a "name" edit too, but falls back
  // to "no circuit selected" (not "Not set") when there's genuinely
  // nothing yet — displayField's own fallback doesn't fit a title.
  const displayName =
    editedFields.name ??
    details?.name ??
    details?.circuit_reference ??
    t('sreMonitor.noCircuitSelected');

  const util = telemetry?.bandwidth_utilization;
  const jitter = telemetry?.jitter;
  const utilPercent = util?.available && util.percent !== undefined ? util.percent : null;
  const jitterMs = jitter?.available && jitter.value_ms !== undefined ? jitter.value_ms : null;

  const currency = details?.rental_currency ?? '';
  const formatCharge = (value: number | null | undefined) =>
    value != null ? `${value.toFixed(2)} ${currency}`.trim() : '—';
  const monthlyEstimate =
    details?.total_rate_per_hour != null ? details.total_rate_per_hour * 24 * 30 : null;

  // No connection looked up yet this conversation — the shared
  // placeholder, rather than pagination/cards full of "—" placeholders.
  // Same convention as SreMonitorPanel.tsx's own early return.
  if (!details) {
    return <InfoCanvasPlaceholder />;
  }

  return (
    <div className="service-config-panel">
      <div className="service-config-pagination-row">
        <PanelPagination
          page={page}
          labels={[
            t('serviceConfig.pages.overview'),
            t('serviceConfig.pages.configuration'),
            t('serviceConfig.pages.insights'),
          ]}
          onChange={setPage}
        />
      </div>

      {page === 0 && (
        <>
          <div className="service-config-map-row" ref={mapRowRef}>
            {(routeLoading || mapWidth === null) && <CityMapLoading width={mapWidth ?? undefined} height={MAP_HEIGHT} />}
            {!routeLoading && mapWidth !== null && route && (
              <CityMap from={route.from} to={route.to} width={mapWidth} height={MAP_HEIGHT} />
            )}
            {!routeLoading && mapWidth !== null && !route && (
              <InfoCanvasPlaceholder width={mapWidth} height={MAP_HEIGHT} />
            )}
          </div>

          <DetailCard
            title={displayName}
            rows={[
              {
                label: t('sreMonitor.fields.circuitReference'),
                value: details?.circuit_reference ?? '—',
              },
              { label: t('sreMonitor.fields.status'), value: details?.status ?? '—' },
              {
                label: t('sreMonitor.fields.connectionType'),
                value: details?.connection_type ?? '—',
              },
              {
                label: t('sreMonitor.fields.currentBandwidth'),
                value: details?.bandwidth_mbps != null ? `${details.bandwidth_mbps} Mbps` : '—',
              },
              { label: t('sreMonitor.fields.ocn'), value: details?.ocn ?? '—' },
              {
                label: t('serviceConfig.description'),
                value: displayField('description', details?.description),
              },
            ]}
          />
        </>
      )}

      {page === 1 && (
        <>
          <DetailCard
            title={t('serviceConfig.vlanConfiguration')}
            rows={[
              { label: t('serviceConfig.vlanId'), value: displayField('vlan_id', details?.vlan_id) },
              {
                label: t('serviceConfig.vlanType'),
                value: displayField('vlan_type', details?.vlan_type),
              },
              {
                label: t('serviceConfig.vlanMapping'),
                value: displayField('vlan_mapping', details?.vlan_mapping),
              },
            ]}
          />

          <DetailCard
            title={t('serviceConfig.configuration')}
            rows={[
              { label: t('serviceConfig.serviceId'), value: details?.connection_id ?? '—' },
              {
                label: t('serviceConfig.commitmentPeriodMonths'),
                value: displayField('commitment_period', details?.commitment_period),
              },
              {
                label: t('serviceConfig.commitmentExpiry'),
                value: formatDateOnly(details?.commitment_expiry),
              },
              {
                label: t('serviceConfig.baseRatePerHour'),
                value: formatCharge(details?.base_rental_charge),
              },
              { label: t('serviceConfig.boostRate'), value: formatCharge(details?.boost_charge) },
              {
                label: t('serviceConfig.totalRatePerHour'),
                value: formatCharge(details?.total_rate_per_hour),
              },
              {
                label: t('serviceConfig.totalEstimatedPerMonth'),
                value: formatCharge(monthlyEstimate),
              },
            ]}
          />
        </>
      )}

      {page === 2 && (
        <>
          <AiConfigReviewNote text={state.ai_config_review} />

          <div className="service-config-performance-title">{t('serviceConfig.performance')}</div>

          {utilPercent !== null ? (
            <Gauge
              value={utilPercent}
              displayValue={`${utilPercent.toFixed(2)}%`}
              label={t('sreMonitor.bandwidthUtilization')}
              statusColor={utilizationColor(utilPercent)}
              statusLabel={
                utilPercent > UTIL_THRESHOLD ? t('sreMonitor.aboveNormal') : t('sreMonitor.normal')
              }
              thresholdPercent={UTIL_THRESHOLD}
              zones={[
                { upTo: UTIL_MID, color: STATUS_GOOD },
                { upTo: UTIL_THRESHOLD, color: STATUS_WARNING },
                { upTo: 100, color: STATUS_CRITICAL },
              ]}
            />
          ) : telemetry ? (
            <div className="service-config-unavailable">
              {t('sreMonitor.bandwidthUtilizationUnavailable')}
            </div>
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

          {jitterMs !== null ? (
            <StatCard
              label={t('sreMonitor.jitter')}
              value={`${jitterMs.toFixed(2)} ms`}
              statusColor={jitterMs >= JITTER_THRESHOLD_MS ? STATUS_CRITICAL : STATUS_GOOD}
              statusLabel={
                jitterMs >= JITTER_THRESHOLD_MS ? t('sreMonitor.elevated') : t('sreMonitor.normal')
              }
            />
          ) : telemetry ? (
            <div className="service-config-unavailable">{t('sreMonitor.jitterUnavailable')}</div>
          ) : (
            <StatCard label={t('sreMonitor.jitter')} value="—" />
          )}
        </>
      )}
    </div>
  );
}
