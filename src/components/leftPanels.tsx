import type { ComponentType } from 'react';
import SreMonitorPanel from '../features/sre/SreMonitorPanel';
import SreClosedLoopPanel from '../features/sre/SreClosedLoopPanel';
import ServiceOrderPanel from '../features/service-order/ServiceOrderPanel';
import ServiceConfigPanel from '../features/service-config/ServiceConfigPanel';

// Every left panel receives the tool_results accumulated so far this
// conversation, keyed by tool name. Untyped here — each agent's own
// panel component narrows this to its tools' actual shapes. Shared by
// AgentPage.tsx's per-specialist lookup (leftPanels[agentId]) below
// and UnifiedLeftPanel.tsx's own agent-name switch (the embedded
// orchestrator chat), which renders these same 3 components directly
// rather than going through this Record.
export interface LeftPanelProps {
  toolResults: Record<string, unknown>;
  selectedCircuitReference?: string | null;
}

// Frontend-side companion to registry/agents.yaml's `left_panel_component`
// field, used by AgentPage.tsx's standalone per-specialist screens.
export const leftPanels: Record<string, ComponentType<LeftPanelProps>> = {
  'service-order': ServiceOrderPanel,
  'sre-monitor': SreMonitorPanel,
  'sre-closed-loop': SreClosedLoopPanel,
  'service-config': ServiceConfigPanel,
};

