import type { ReactNode } from 'react';
import InvoiceCard from '../service-order/InvoiceCard';
import PortSearch from '../service-order/PortSearch';
import PricingOptions from '../service-order/PricingOptions';
import RecommendationOptions from '../service-order/RecommendationOptions';
import BuildingSearch from '../service-order/BuildingSearch';
import BandwidthOptions from '../service-order/BandwidthOptions';
import CircuitTable from '../sre/CircuitTable';
import TimePeriodTable from '../sre/TimePeriodTable';
import CircuitRulesTable from '../sre/CircuitRulesTable';
import AuditLogTable from '../sre/AuditLogTable';
import OrderTypeOptions from '../service-order/OrderTypeOptions';
import PortSiteOptions from '../service-order/PortSiteOptions';
import type {
  InvoiceResult,
  ListBuildingSitesResult,
  OptionListResult,
  ListActiveCircuitsResult,
  ListBandwidthsResult,
  ListBuildingsResult,
  ListPortsResult,
  PresentTimePeriodOptionsResult,
  PricingOptionsResult,
  RecommendationResult,
  ReliabilityAuditEntry,
  ReliabilityRule,
} from '../../api/types';
import i18n from '@aicoe/aihub-platform/i18n';

// Companion to UnifiedLeftPanel.tsx/leftPanels.tsx, but for the chat
// stream itself: a turn can optionally render something *before* its
// chat bubble (e.g. a dedicated Quote card, or an interactive picker),
// keyed off that turn's tool_results. ChatPanel calls this
// unconditionally for every turn, in both the embedded orchestrator
// chat (ChatPage.tsx) and every standalone specialist screen
// (AgentPage.tsx) — every tool name checked below is unique to its
// own specialist EXCEPT list_active_circuits, which both the Service
// Observability Agent and the Service Reliability Agent call (the latter
// alongside list_reliability_rules, checked first below so that
// combination renders one joined table instead of two) — so this never
// misfires for a turn handled by an unrelated specialist (their
// tool_results just won't match anything here, and the function returns
// null). Add more `const x = toolResults.some_tool as SomeType` checks
// here if another specialist gets a chat-extra card.
//
// `i18n.t(...)` (the standalone instance, not the `useTranslation()`
// hook) is used below for the couple of translated strings this plain
// function needs to hand to its children as props — hooks only work
// inside a component/another hook, and this is neither. It still stays
// in sync with the active language: ChatPanel.tsx (the only caller)
// already re-renders on a language change via its own `useTranslation()`
// call, and this function re-runs as part of that same render.
export function renderChatExtra(
  toolResults: Record<string, unknown>,
  sendMessage: (text: string) => void,
  assistantText = '',
  onCircuitSelect?: (circuitReference: string) => void,
): ReactNode {
  // preview_invoice renders the same card, pre-confirmation, marked
  // Pending — create_invoice (post-confirmation, Confirmed) is checked
  // first since only one of the two ever appears on a given turn.
  const invoice = (toolResults.create_invoice ?? toolResults.preview_invoice) as
    | InvoiceResult
    | undefined;
  if (invoice) return <InvoiceCard invoice={invoice} />;

  // search_existing_ports (Flow D) and present_port_matches (Flow E's
  // Existing Port Inventory Check) share the same picker — only one is
  // ever called on a given turn.
  // list_comcast_port_candidates returns the same shape (Index, Port
  // Name, Building Name, Site) as the Existing Port Inventory Check
  // tools above — only one of the three is ever present on a given
  // turn, so they all share PortSearch's picker. Colt-Offnet has no
  // equivalent tool (create_offnet_location is itself a simulation, so
  // there's no real "site" inventory to list candidates from).
  const portSearch = (toolResults.search_existing_ports ??
    toolResults.present_port_matches ??
    toolResults.list_comcast_port_candidates ??
    toolResults.filter_ports_by_bandwidth) as ListPortsResult | undefined;
  if (portSearch) return <PortSearch result={portSearch} onSelect={sendMessage} />;

  const buildingSearch = toolResults.list_buildings_by_address as ListBuildingsResult | undefined;
  if (buildingSearch) return <BuildingSearch result={buildingSearch} onSelect={sendMessage} />;

  // Ethernet Port's bandwidth-selection step, once a building is picked
  // — real available capacity at that building rather than the standard
  // tier list, so it gets its own picker (see PortSiteOptions.tsx).
  const buildingSites = toolResults.list_building_sites as ListBuildingSitesResult | undefined;
  if (buildingSites) return <PortSiteOptions result={buildingSites} onSelect={sendMessage} />;

  // Routing framework selection takes priority over bandwidth picker
  // results retained from an earlier step in this chat session.
  const orderTypeOptions = (toolResults.present_order_type_options ??
    toolResults.present_connection_framework_options) as OptionListResult | undefined;
  if (orderTypeOptions) return <OrderTypeOptions result={orderTypeOptions} onSelect={sendMessage} />;
  const frameworkPromptWithoutTool =
    toolResults.present_connection_framework_options === undefined &&
    /please\s+choose\s+the\s+(?:\*{1,2})?connection\s+framework/i.test(assistantText);
  if (frameworkPromptWithoutTool) {
    return <OrderTypeOptions result={{ options: [
      { index: 1, label: 'EPL', description: 'Point-to-point — a dedicated line between exactly two sites.' },
      { index: 2, label: 'EVPL', description: 'Ethernet virtual line — supports multiple VLAN-tagged lines.' },
    ] }} onSelect={sendMessage} />;
  }

  // Only one of the two is ever called on a given turn (Colt-Offnet vs.
  // Comcast-Offnet).
  const bandwidthOptions = (toolResults.list_offnet_bandwidths ??
    toolResults.list_comcast_bandwidths) as ListBandwidthsResult | undefined;
  if (bandwidthOptions) return <BandwidthOptions result={bandwidthOptions} onSelect={sendMessage} />;

  const bandwidthRecommendation = toolResults.present_bandwidth_recommendation as
    | RecommendationResult
    | undefined;
  if (bandwidthRecommendation) {
    return (
      <RecommendationOptions
        label={i18n.t('common.bandwidth')}
        result={bandwidthRecommendation}
        onSelect={sendMessage}
      />
    );
  }

  const commitmentRecommendation = toolResults.present_commitment_recommendation as
    | RecommendationResult
    | undefined;
  if (commitmentRecommendation) {
    return (
      <RecommendationOptions
        label={i18n.t('common.commitmentPeriod')}
        result={commitmentRecommendation}
        onSelect={sendMessage}
      />
    );
  }

  // Only one pricing tool is ever called on a given turn — first-present
  // wins, same pattern as create_invoice ?? preview_invoice above.
  const pricingOptions = (toolResults.get_ethernet_port_price ??
    toolResults.get_dia_price ??
    toolResults.get_ethernet_circuit_price ??
    toolResults.get_offnet_port_price ??
    toolResults.get_fttx_price ??
    toolResults.get_comcast_port_price ??
    toolResults.get_offnet_port_mod_options) as PricingOptionsResult | undefined;
  if (pricingOptions) return <PricingOptions result={pricingOptions} onSelect={sendMessage} />;

  const activeCircuits = toolResults.list_active_circuits as ListActiveCircuitsResult | undefined;
  const reliabilityRules = toolResults.list_reliability_rules as
    | { rules: ReliabilityRule[] }
    | undefined;
  // The Service Reliability Agent's "show reliability rules" step calls
  // BOTH tools in the same turn — checked before the plain activeCircuits
  // case below so that turn renders one joined, clickable table instead
  // of this card followed by a second, redundant generic CircuitTable.
  if (activeCircuits && reliabilityRules) {
    return (
      <CircuitRulesTable
        circuits={activeCircuits}
        rules={reliabilityRules.rules ?? []}
        onSelect={sendMessage}
      />
    );
  }

  if (activeCircuits && !toolResults.boost_bandwidth) {
    return (
      <CircuitTable
        result={activeCircuits}
        onSelect={sendMessage}
        onCircuitSelect={onCircuitSelect}
      />
    );
  }

  const timePeriodOptions = toolResults.present_time_period_options as
    | PresentTimePeriodOptionsResult
    | undefined;
  if (timePeriodOptions) return <TimePeriodTable result={timePeriodOptions} onSelect={sendMessage} />;

  // The Service Reliability Agent's "show audit log" step — not
  // clickable, unlike every other card here (see AuditLogTable.tsx).
  const auditLog = toolResults.list_audit_log as { audit_log: ReliabilityAuditEntry[] } | undefined;
  if (auditLog) return <AuditLogTable entries={auditLog.audit_log ?? []} />;

  // Routing's order-type menu and the EPL/EVPL choice that follows it —
  // same OptionListResult shape from the backend, so one component
  // serves both. Only one is ever called on a given turn (the second
  // only after the user has picked "Ethernet Connection" from the
  // first), so first-present wins, same pattern as create_invoice ??
  // preview_invoice above.
  // Fallback for the one step the model has been observed to narrate in
  // prose instead of calling its tool: it writes "Please choose the
  // connection framework below." and then stops, leaving nothing to
  // click and the flow dead. present_connection_framework_options is
  // pure display data built from a fixed two-item list in the backend
  // (_CONNECTION_FRAMEWORK_OPTIONS in service_order/tools.py) — no Colt
  // call, nothing persisted — so synthesizing it here is safe and shows
  // exactly what the tool would have. Deliberately last: it only runs
  // once every real tool_result above has failed to match, and only when
  // the tool genuinely wasn't called, so a real call always wins. Drop
  // this whole block once the model reliably calls the tool; the branch
  // above is the actual feature.
  return null;
}
