import { useEffect, useRef, useState } from 'react';
import { Calendar, Gauge, MapPin, Plug, Route, Tag, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LeftPanelProps } from './leftPanels';
import type { RecommendationResult, ServiceOrderState } from '../types';
import CityMap, { type CityMapPoint } from './CityMap';
import AiAnalysisNote from './AiAnalysisNote';
import InfoCanvasPlaceholder from './InfoCanvasPlaceholder';
import { PanelPagination } from '@aicoe/aihub-platform/ui';

// Source/destination marker colors, distinct from the shared CityMap
// component's own single-color default (used by the Service
// Observability/Reliability Agents' maps, which only ever plot one
// circuit's two ends as one undifferentiated pair) — a Connection order's
// two ports are conceptually different roles, worth telling apart at a
// glance.
const SOURCE_COLOR = '#00D7BD';
const DESTINATION_COLOR = '#db2777';
// Mirrors SreMonitorPanel.tsx's own map-row sizing exactly — same
// full-width-via-ResizeObserver pattern, since this panel is equally
// user-resizable (the draggable left/right split).
const MAP_HEIGHT = 180;
const MAP_CARD_PADDING = 24;
const INITIAL_MAP_WIDTH = 320;

// Renders CityMap full-width for this panel's Connection map row, plus a
// small legend distinguishing the two marker colors — kept local here
// since neither concern (per-panel color legend, ResizeObserver sizing)
// is CityMap's own to own generically; every other caller just passes
// its own explicit width.
function ConnectionMap({ source, destination }: { source?: CityMapPoint; destination?: CityMapPoint }) {
  const { t } = useTranslation();
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

  return (
    <div className="order-map-row" ref={mapRowRef}>
      <CityMap from={source} to={destination} width={mapWidth} height={MAP_HEIGHT} />
      <div className="order-map-legend">
        {source && (
          <span className="order-map-legend-item">
            <span className="order-map-legend-dot" style={{ background: SOURCE_COLOR }} />
            {t('serviceOrder.portMap.source')}
          </span>
        )}
        {destination && (
          <span className="order-map-legend-item">
            <span className="order-map-legend-dot" style={{ background: DESTINATION_COLOR }} />
            {t('serviceOrder.portMap.destination')}
          </span>
        )}
      </div>
    </div>
  );
}

// NaasChatScreen accumulates tool_results for the whole chat session and
// never clears a key — fine for sre-monitor, but here it means a second,
// independent flow later in the same conversation (another Port order,
// or a Connection order after a Port order) would otherwise still show
// the first flow's stale summary/recommendations. start_service_order_
// flow's `started_at` changes on every call (even a repeat of the same
// flow type), so it's used here as a reset marker: whenever it changes,
// whatever this field's value was *before* that point is treated as
// stale and ignored going forward. Generic so update_order_summary,
// present_bandwidth_recommendation, and present_commitment_recommendation
// all reset in sync on the same flow-start transition, each independently
// (own baseline), rather than duplicating this per field.
function useResettableField<T>(current: T | undefined, startedAt: string | undefined): T | undefined {
  // Render-phase state adjustment (the React-sanctioned pattern) rather
  // than mutating refs during render — the latter trips react-hooks/refs
  // (refs aren't read/written during render). On a flow-start transition
  // (startedAt changed) the current value becomes the new baseline, and
  // anything equal to that baseline is treated as stale and hidden.
  const [baseline, setBaseline] = useState<T | undefined>(undefined);
  const [lastStartedAt, setLastStartedAt] = useState<string | undefined>(undefined);

  if (startedAt !== undefined && startedAt !== lastStartedAt) {
    setBaseline(current);
    setLastStartedAt(startedAt);
  }

  return current !== baseline ? current : undefined;
}

// Bandwidth/commitment-period recommendations already render their own
// clickable picker card in the chat (present_bandwidth_recommendation/
// present_commitment_recommendation, see RecommendationOptions.tsx) —
// this is an *additional* left-panel surface of that same reasoning
// (recommended value + real reason), same pattern as the Service
// Observability Agent's AI Analysis note, not a replacement for the
// chat card.
function recommendationNote(label: string, rec?: RecommendationResult): string | undefined {
  if (!rec) return undefined;
  return `${label} recommendation: ${rec.recommended}. ${rec.reason}`;
}

interface FieldRowProps {
  icon: LucideIcon;
  label: string;
  value?: string;
}

function FieldRow({ icon: Icon, label, value }: FieldRowProps) {
  const { t } = useTranslation();
  const filled = value !== undefined && value !== '';
  return (
    <div className={`order-field ${filled ? 'order-field--filled' : 'order-field--pending'}`}>
      <span className="order-field-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="order-field-text">
        <span className="order-field-label">{label}</span>
        <span className="order-field-value">{filled ? value : t('emptyStates.notYetProvided')}</span>
      </span>
    </div>
  );
}

// This agent's left panel: a plain, progressively-filled summary of the
// current order's known fields, driven entirely by
// update_order_summary's latest result — no flowchart, no derived
// step/branch state.
export default function ServiceOrderPanel({ toolResults }: LeftPanelProps) {
  const { t } = useTranslation();
  const state = toolResults as ServiceOrderState;
  const startFlow = state.start_service_order_flow;
  const startedAt = startFlow?.started_at;
  const summary = useResettableField(state.update_order_summary, startedAt);
  const bandwidthRec = useResettableField(state.present_bandwidth_recommendation, startedAt);
  const commitmentRec = useResettableField(state.present_commitment_recommendation, startedAt);
  const hasRecommendation = Boolean(bandwidthRec || commitmentRec);
  const [page, setPage] = useState(0);
  const hasInvoice = Boolean(toolResults.preview_invoice || toolResults.create_invoice);
  const labels = hasRecommendation
    ? [t('serviceOrder.pages.orderSummary'), t('serviceOrder.pages.aiRecommendation')]
    : [t('serviceOrder.pages.orderSummary')];
  const activePage = Math.min(page, labels.length - 1);

  // Render-phase state adjustments (see useResettableField above) rather
  // than setState-in-effect: each tracks its own trigger's last-seen value
  // and reacts only on the transition, independently of the others.
  const [pagingStartedAt, setPagingStartedAt] = useState(startedAt);
  if (startedAt !== pagingStartedAt) {
    setPagingStartedAt(startedAt);
    setPage(0);
  }
  const [lastHasRecommendation, setLastHasRecommendation] = useState(hasRecommendation);
  if (hasRecommendation !== lastHasRecommendation) {
    setLastHasRecommendation(hasRecommendation);
    if (hasRecommendation) setPage(1);
  }
  const [lastHasInvoice, setLastHasInvoice] = useState(hasInvoice);
  if (hasInvoice !== lastHasInvoice) {
    setLastHasInvoice(hasInvoice);
    if (hasInvoice) setPage(0);
  }

  if (!startFlow) {
    return <InfoCanvasPlaceholder />;
  }

  if (!summary && !(hasRecommendation && activePage === 1)) {
    // The flow has started but update_order_summary hasn't fired yet
    // (e.g. still validating the address) — show the map card right
    // away instead of the generic empty state above, so the panel never
    // looks dead while the chat is clearly already in progress. The
    // shared Info Canvas placeholder until real coordinates exist, same
    // pattern the Service Reliability Agent's panel already uses before
    // any rule exists.
    return (
      <div className="service-order-panel">
        <h3 className="service-order-panel-title">{t('serviceOrder.pages.orderSummary')}</h3>
        {startFlow.flow === 'circuit' ? (
          <ConnectionMap />
        ) : (
          <InfoCanvasPlaceholder width={296} height={180} />
        )}
        <p className="service-order-panel-hint">{t('serviceOrder.gatheringDetails')}</p>
      </div>
    );
  }

  // Flow E-only extras (unified DIA-or-Ethernet circuit ordering) — only
  // shown once actually set, unlike the core fields above which always
  // render (filled or "Not yet provided"). Flow B/C orders never set
  // these, so they simply never appear for those. summary.vlan_type/
  // vlan_id are live API data (excluded from translation); only the "VLAN
  // — " wrapping text (serviceOrder.vlanLine) is this app's own UI copy.
  const vlan = summary &&
    summary.vlan_type !== undefined
      ? summary.vlan_id
        ? t('serviceOrder.vlanLine', { vlanType: summary.vlan_type, vlanId: summary.vlan_id })
        : summary.vlan_type
      : undefined;

  if (summary?.order_type === 'connection') {
    return (
      <div className="service-order-panel">
        <PanelPagination page={activePage} labels={labels} onChange={setPage} />
        {activePage === 0 ? <>
        <h3 className="service-order-panel-title">{t('serviceOrder.pages.orderSummary')}</h3>
        <ConnectionMap
          source={
            summary.source_lat !== undefined && summary.source_lng !== undefined
              ? {
                  latitude: summary.source_lat,
                  longitude: summary.source_lng,
                  city: summary.source_city,
                  color: SOURCE_COLOR,
                }
              : undefined
          }
          destination={
            summary.destination_lat !== undefined && summary.destination_lng !== undefined
              ? {
                  latitude: summary.destination_lat,
                  longitude: summary.destination_lng,
                  city: summary.destination_city,
                  color: DESTINATION_COLOR,
                }
              : undefined
          }
        />
        <div className="order-fields">
          <FieldRow
            icon={Plug}
            label={t('serviceOrder.fields.sourceAddress')}
            value={summary.source_address ?? summary.source_port}
          />
          <FieldRow
            icon={Plug}
            label={t('serviceOrder.fields.destinationAddress')}
            value={summary.destination_address ?? summary.destination_port}
          />
          <FieldRow icon={Gauge} label={t('serviceOrder.fields.bandwidth')} value={summary.bandwidth} />
          <FieldRow
            icon={Calendar}
            label={t('serviceOrder.fields.commitmentPeriod')}
            value={summary.commitment_period}
          />
          {vlan !== undefined && <FieldRow icon={Route} label={t('serviceOrder.fields.vlan')} value={vlan} />}
        </div>
        </> : <>
        <h3 className="service-order-panel-title">{t('serviceOrder.pages.aiRecommendation')}</h3>
        <AiAnalysisNote text={recommendationNote(t('serviceOrder.fields.bandwidth'), bandwidthRec)} />
        <AiAnalysisNote text={recommendationNote(t('serviceOrder.fields.commitmentPeriod'), commitmentRec)} />
        </>}
      </div>
    );
  }

  if (activePage === 1) {
    return (
      <div className="service-order-panel">
        <PanelPagination page={activePage} labels={labels} onChange={setPage} />
        <h3 className="service-order-panel-title">{t('serviceOrder.pages.aiRecommendation')}</h3>
        <AiAnalysisNote text={recommendationNote(t('serviceOrder.fields.bandwidth'), bandwidthRec)} />
        <AiAnalysisNote text={recommendationNote(t('serviceOrder.fields.commitmentPeriod'), commitmentRec)} />
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="service-order-panel">
      <PanelPagination page={activePage} labels={labels} onChange={setPage} />
      {activePage === 0 ? <>
      <h3 className="service-order-panel-title">{t('serviceOrder.pages.orderSummary')}</h3>
      <div className="order-fields">
        <FieldRow icon={MapPin} label={t('serviceOrder.fields.location')} value={summary.location} />
        <FieldRow icon={Gauge} label={t('serviceOrder.fields.bandwidth')} value={summary.bandwidth} />
        <FieldRow icon={Tag} label={t('serviceOrder.fields.price')} value={summary.price} />
        {summary.ip_assignment !== undefined && (
          <FieldRow icon={Route} label={t('serviceOrder.fields.ipAssignment')} value={summary.ip_assignment} />
        )}
      </div>
      </> : <>
      <h3 className="service-order-panel-title">{t('serviceOrder.pages.aiRecommendation')}</h3>
      <AiAnalysisNote text={recommendationNote('Bandwidth', bandwidthRec)} />
      </>}
    </div>
  );
}
