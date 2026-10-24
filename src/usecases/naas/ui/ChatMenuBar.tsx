import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../naas.css';

// Same 4 specialists ActiveAgentSidebar.tsx used to list all of at once —
// this only ever shows the one that's actually active, so no descriptions
// needed here. Labels deliberately drop the trailing "Agent" (e.g.
// "Service Order", not "Service Order Agent") — this menu already reads
// as agent-related from context, so repeating the word on every label was
// just noise.
const AGENT_LABEL_KEYS: Record<string, string> = {
  service_order: 'navbar.agents.serviceOrder',
  sre_monitor: 'navbar.agents.serviceObservability',
  sre_closed_loop: 'navbar.agents.serviceReliability',
  service_config: 'navbar.agents.serviceConfig',
};

interface ChatMenuBarProps {
  // Same ADK agent name ChatScreen.tsx already tracks for UnifiedLeftPanel
  // — null until the first tool call this conversation, in which case the
  // hamburger has nothing to show on hover yet (falls back to
  // navbar.activeAgentTooltip's explanation instead).
  activeAgent: string | null;
}

// Pinned to the top of the chat window itself (ChatScreen.tsx renders this
// just above ChatPanel, only once a conversation has started) — replaces
// ActiveAgentSidebar's old standalone column, which listed all 4
// specialists at once with the active one highlighted. This only ever
// shows the one that's actually active, on hover (a plain CSS hover
// popover, not a click-to-open menu — tried the click variant, reverted
// per explicit feedback), keeping the chat window itself as the only
// two-pane layout (chat + Info Canvas) rather than a third permanent
// column. The Home button that used to live here moved to Navbar.tsx,
// beside the logo — this bar is just the active-agent indicator now.
export default function ChatMenuBar({ activeAgent }: ChatMenuBarProps) {
  const { t } = useTranslation();
  const activeAgentLabel = activeAgent ? t(AGENT_LABEL_KEYS[activeAgent] ?? activeAgent) : null;

  return (
    <div className="chat-menu-bar">
      <div className="chat-menu-hover-wrap">
        <button
          type="button"
          className="chat-menu-hamburger"
          aria-label={t('navbar.activeAgent')}
          title={activeAgentLabel ? undefined : t('navbar.activeAgentTooltip')}
        >
          <Bot size={17} />
        </button>

        {activeAgentLabel && (
          <div className="chat-menu-hover-panel" role="tooltip">
            <span className="chat-menu-hover-label">{t('navbar.activeAgent')}</span>
            <span className="chat-menu-hover-value">{activeAgentLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}