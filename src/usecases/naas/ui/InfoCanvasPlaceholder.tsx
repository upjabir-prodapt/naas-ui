import { LayoutDashboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface InfoCanvasPlaceholderProps {
  // Both optional — omitted entirely by callers that just want this to
  // fill its parent (UnifiedLeftPanel's fully-empty orchestrator state,
  // DefaultLeftPanel's per-specialist "coming soon" fallback); passed by
  // callers standing this in for a single fixed-size slot within an
  // otherwise-populated panel (e.g. the map row in SreMonitorPanel/
  // SreClosedLoopPanel/ServiceConfigPanel/ServiceOrderPanel before a
  // circuit or order exists to plot).
  width?: number;
  height?: number;
}

// The one shared "nothing real to show yet" placeholder — used both for a
// whole panel with nothing at all (no specialist has acted this
// conversation, or this agent's UI isn't built yet) and for a single slot
// inside an otherwise-populated panel (a route map before any circuit/
// order has one to plot). Replaces what used to be two different
// defaults: PlaceholderPanel's plain sentence, and CityMap's WorldMap
// standing in for "no route yet" in four panels — one consistent look
// everywhere instead. No title of its own — every caller renders inside
// the persistent "Info Canvas" section header (NaasAgentScreen.tsx/
// NaasChatScreen.tsx's own agent-screen-left-header), so repeating the
// title here would just duplicate it right below itself.
export default function InfoCanvasPlaceholder({ width, height }: InfoCanvasPlaceholderProps) {
  const { t } = useTranslation();
  return (
    <div className="info-canvas-placeholder" style={{ width, height }}>
      <LayoutDashboard size={26} strokeWidth={1.5} className="info-canvas-placeholder-icon" />
      <span className="info-canvas-placeholder-subtitle">{t('infoCanvas.subtitle')}</span>
    </div>
  );
}
