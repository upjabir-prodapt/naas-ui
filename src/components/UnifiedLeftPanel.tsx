import InfoCanvasPlaceholder from './InfoCanvasPlaceholder';
import ServiceOrderPanel from '../features/service-order/ServiceOrderPanel';
import SreMonitorPanel from '../features/sre/SreMonitorPanel';
import SreClosedLoopPanel from '../features/sre/SreClosedLoopPanel';
import ServiceConfigPanel from '../features/service-config/ServiceConfigPanel';
import type { LeftPanelProps } from './leftPanels';

// The merged orchestrator interface has one left-panel area that
// auto-switches between the 4 specialists' existing, unchanged panel
// components based on `lastActiveAgent` — the ADK agent name
// (`event.author`, underscored — "service_order"/"sre_monitor"/
// "sre_closed_loop"/"service_config") of whichever specialist most recently called a
// tool this conversation (see ChatPage.tsx, which tracks this from
// ChatPanel's onToolResults callback). Nothing has happened yet (no
// specialist has acted this conversation) is the only case that falls
// through to the placeholder — a stale/unset `lastActiveAgent` never
// hides an already-populated panel, since it only ever changes forward.
export default function UnifiedLeftPanel({
  toolResults,
  lastActiveAgent,
  selectedCircuitReference,
}: LeftPanelProps & { lastActiveAgent: string | null }) {
  switch (lastActiveAgent) {
    case 'service_order':
      return <ServiceOrderPanel toolResults={toolResults} />;
    case 'sre_monitor':
      return (
        <SreMonitorPanel
          toolResults={toolResults}
          selectedCircuitReference={selectedCircuitReference}
        />
      );
    case 'sre_closed_loop':
      return <SreClosedLoopPanel />;
    case 'service_config':
      return <ServiceConfigPanel toolResults={toolResults} />;
    default:
      return <InfoCanvasPlaceholder />;
  }
}
