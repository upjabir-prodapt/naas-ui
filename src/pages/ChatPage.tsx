import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import UnifiedLeftPanel from '../components/UnifiedLeftPanel';
import { renderChatExtra } from '../features/chat/chatExtras';
import ChatPanel, { type ChatPanelHandle } from '../features/chat/ChatPanel';
import Navbar from '../components/Navbar';
import ChatHistoryPanel from '../components/ChatHistoryPanel';
import { useNaasLanguage } from '../i18n/useNaasLanguage';
import {
  closeChat,
  fetchChat,
  fetchChatHistory,
  renameChat,
  type ChatHistoryMessage,
  type ChatSummary,
} from '../api/client';
import '../styles/naas.css';
import ChatMenuBar from '../components/ChatMenuBar';

// Narrow on purpose: it takes its width from the chat column, not the
// Info Canvas. Scales with the screen between the two bounds.
const HISTORY_PANEL_WIDTH = 'clamp(190px, 16vw, 230px)';

// History lists only the main chat's conversations (ChatPanel's
// orchestrator id). The backend also records chats from the standalone
// /naas/agents/:agentId testing screens; reopening one here would send its
// next message to the orchestrator, which has no memory of that chat.
const LISTED_AGENT_ID = 'orchestrator';

// Same rule as the backend's chat_transcript_repository.make_title, so a
// new chat is listed under the title it will be saved with.
const TITLE_MAX_CHARS = 60;

function makeTitle(firstMessage: string): string {
  const text = firstMessage.split(/\s+/).filter(Boolean).join(' ');
  return text.length <= TITLE_MAX_CHARS
    ? text
    : `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}
const DEFAULT_RIGHT_WIDTH_PERCENT = 40;
const MIN_RIGHT_WIDTH_PERCENT = 20;
const MAX_RIGHT_WIDTH_PERCENT = 50;

// Spans all 3 specialist domains, so whichever one the user picks, the
// orchestrator has something concrete to route on immediately. `text` is
// what actually gets sent as the chat message on click — always English,
// regardless of UI language, since it's literal input the orchestrator's
// prompt resolves by phrasing, same reasoning as the picker components'
// "I'll check circuit #N..." messages (see chatExtras.tsx's callers).
// `labelKey` is only what the button displays.
const SAMPLE_PROMPTS: { labelKey: string; text: string }[] = [
  {
    labelKey: 'welcome.samplePrompts.order',
    text: 'Help me place a new Ethernet Connection order',
  },
  {
    labelKey: 'welcome.samplePrompts.rules',
    text: 'Show my active reliability rules',
  },
  {
    labelKey: 'welcome.samplePrompts.telemetry',
    text: 'Show the telemetry for my connections',
  },
  {
    labelKey: 'welcome.samplePrompts.config',
    text: "View or edit a connection's configuration",
  },
];

// Loose/defensive on purpose: toolResults is generic (Record<string,
// unknown>) since this doesn't know any specialist's specific tool
// shapes — this just needs to answer "does this look like a non-empty
// circuits list?" without importing an agent-specific type here.
function circuitsArray(value: unknown): unknown[] {
  if (typeof value !== 'object' || value === null) return [];
  const circuits = (value as { circuits?: unknown }).circuits;
  return Array.isArray(circuits) ? circuits : [];
}

// Mounted at "/naas" — a single, unified interface: a persistent Navbar on
// top (brand + which specialist is currently active + language + admin
// link), and below it either a clean, centered "what do you want to do?"
// welcome screen (Claude-style, no agent cards — the orchestrator decides
// which specialist handles a request, the user never picks one directly)
// or, once the conversation has actually started, the same split
// left-panel/chat layout AgentPage.tsx's standalone screens use. The
// 3 specialists remain directly reachable at their own
// "/naas/agents/:agentId" route (AgentPage.tsx, untouched) for
// isolated testing — just no longer linked from this screen.
//
// One ChatPanel instance carries a session across the welcome <-> split
// layout switch — only its `variant` prop and surrounding layout change,
// so the session and its accumulated messages carry over untouched.
// autoGreet is off here (unlike AgentPage.tsx's standalone screens)
// since the welcome heading below already covers what an opening greeting
// bubble would say — the first message actually shown once the transcript
// appears is the user's own. This instance is only ever remounted (a fresh
// session, via the `chatInstance` key) when the user explicitly closes the
// session with Navbar's "New chat" button — see handleNewChat.
export default function ChatPage() {
  const { t } = useTranslation();
  const [language, setLanguage] = useNaasLanguage();
  // Accumulated across the whole conversation, not replaced per turn — a
  // tool only re-appears here on the turn it's actually called again
  // (e.g. the circuit list is fetched once, telemetry is refetched per
  // selection), so a naive replace would drop the circuit list as soon
  // as the user picked one. See leftPanels.tsx's LeftPanelProps.
  const [toolResults, setToolResults] = useState<Record<string, unknown>>({});
  const [selectedCircuitReference, setSelectedCircuitReference] = useState<string | null>(null);
  // Which specialist most recently called a tool this conversation (ADK
  // agent name, e.g. "service_order") — drives both UnifiedLeftPanel's
  // auto-switch and Navbar's active-agent highlight. null until the first
  // tool call.
  const [lastActiveAgent, setLastActiveAgent] = useState<string | null>(null);
  // True from the moment the user actually sends their first message this
  // session — ChatPanel's onFirstMessageSent, fired on Enter/Send (or
  // a sample prompt's own send, see sendSamplePrompt below), deliberately
  // NOT while they're still typing it, so the layout stays put until
  // there's an actual turn to show. Switches from the centered welcome
  // screen to the split layout; this is a one-way transition for the
  // session, matching how Claude's own landing screen behaves once a
  // conversation starts.
  const [chatStarted, setChatStarted] = useState(false);
  const chatPanelRef = useRef<ChatPanelHandle>(null);
  // Bumped on "New chat" (see handleNewChat) and used as ChatPanel's
  // `key` — changing a component's key forces React to unmount the old
  // instance and mount a fresh one, which is what actually closes the old
  // session (a new sessionId, empty messages) rather than just hiding it.
  const [chatInstance, setChatInstance] = useState(0);
  // Draggable split between chat and the info canvas — resets to 60/40
  // on reload rather than persisting (deliberately simple).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [rightWidthPercent, setRightWidthPercent] = useState(DEFAULT_RIGHT_WIDTH_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  // Past chats (ChatHistoryPanel.tsx), opened from Navbar's History button.
  const [historyOpen, setHistoryOpen] = useState(false);
  // The user's chats, newest first: fetched once per page load (one
  // BigQuery query) and kept up to date locally after that — a new chat,
  // a chat ending and a rename all change it here without refetching.
  // null while loading.
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [chatsLoadFailed, setChatsLoadFailed] = useState(false);
  const historyLoadStartedRef = useRef(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  // The chat on screen — null on the welcome screen until the first
  // message is sent. Highlighted in the history list.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // A past chat being continued: ChatPanel mounts with its session id
  // and messages instead of a fresh session.
  const [restoredChat, setRestoredChat] = useState<{
    sessionId: string;
    messages: ChatHistoryMessage[];
  } | null>(null);
  // Whether the chat on screen has turns not yet saved to BigQuery: leaving
  // it then saves it and moves it to the top of History as just ended.
  const hasNewTurnsRef = useRef(false);
  // The first message of a new chat — its History title once the first
  // turn completes (the backend only records completed turns).
  const firstMessageRef = useRef<string | null>(null);
  // activeSessionId, readable from the page-leave handler below (which is
  // registered once) and after ChatPanel's own ref is already detached.
  const activeSessionIdRef = useRef<string | null>(null);

  function setActiveSession(sessionId: string | null) {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
  }

  // The list is one Firestore read (the user's record), so it is fetched
  // on page load and again whenever History is opened or a chat finishes in
  // the background — the panel always matches Firestore, even for a chat
  // the user left before its first reply arrived. A failed refresh keeps
  // the list already on screen.
  function loadChats({ refresh = false }: { refresh?: boolean } = {}) {
    if (!refresh) setChatsLoadFailed(false);
    fetchChatHistory()
      .then((result) => {
        setChats(result.filter((chat) => chat.agent_id === LISTED_AGENT_ID));
        setChatsLoadFailed(false);
      })
      .catch(() => {
        if (refresh) return;
        setChats([]);
        setChatsLoadFailed(true);
      });
  }

  // Once per page load. The ref keeps it to one request even where React
  // runs mount effects twice (development).
  useEffect(() => {
    if (historyLoadStartedRef.current) return;
    historyLoadStartedRef.current = true;
    loadChats();
  }, []);

  // Saves the chat on screen to BigQuery (POST /chats/{id}/close) as the
  // user leaves it — only when it has new turns, so merely viewing a past
  // chat doesn't write it again. Fire-and-forget: a failure must not block
  // starting or opening another chat — the chat stays in Firestore.
  function leaveCurrentChat({ keepalive = false }: { keepalive?: boolean } = {}) {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || !hasNewTurnsRef.current) return;
    hasNewTurnsRef.current = false;
    closeChat(sessionId, { keepalive }).catch(() => {});
  }

  async function handleRenameChat(sessionId: string, title: string) {
    setHistoryError(null);
    try {
      await renameChat(sessionId, title);
    } catch (err) {
      setHistoryError(t('history.renameFailed'));
      throw err;
    }
    setChats((prev) =>
      prev ? prev.map((c) => (c.session_id === sessionId ? { ...c, title } : c)) : prev,
    );
  }

  // Leaving the page (tab closed, reload, browser navigation) or this screen
  // (e.g. the Admin link) archives the chat too — otherwise only Home and
  // switching chats would, and a chat the user simply walked away from
  // would never reach BigQuery. `pagehide` rather than `beforeunload`: it
  // also fires when the page goes into the back/forward cache, and doesn't
  // block it. Not on tab switches (`visibilitychange`), which would archive
  // a chat the user is still in.
  useEffect(() => {
    const onPageHide = () => leaveCurrentChat({ keepalive: true });
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      leaveCurrentChat({ keepalive: true });
    };
    // Registered once: everything it reads is a ref or a state setter.
  }, []);

  function resetChatState() {
    setLastActiveAgent(null);
    setToolResults({});
    setSelectedCircuitReference(null);
    setRightWidthPercent(DEFAULT_RIGHT_WIDTH_PERCENT);
  }

  function handleNewChat() {
    leaveCurrentChat();
    resetChatState();
    setChatStarted(false);
    setActiveSession(null);
    setRestoredChat(null);
    firstMessageRef.current = null;
    setChatInstance((n) => n + 1);
  }

  async function handleOpenChat(sessionId: string) {
    setOpeningChat(true);
    setHistoryError(null);
    try {
      const chat = await fetchChat(sessionId);
      leaveCurrentChat();
      resetChatState();
      // Rebuild the Info Canvas exactly as the live chat left it, by
      // replaying each turn's tool_results in order through the same
      // merge the live chat uses.
      for (const message of chat.messages) {
        if (message.role === 'assistant' && Object.keys(message.tool_results).length > 0) {
          handleToolResults(message.tool_results, message.agent ?? undefined);
        }
      }
      setRestoredChat({ sessionId: chat.session_id, messages: chat.messages });
      setActiveSession(chat.session_id);
      firstMessageRef.current = null;
      setChatStarted(true);
      setChatInstance((n) => n + 1);
    } catch {
      setHistoryError(t('history.openFailed'));
    } finally {
      setOpeningChat(false);
    }
  }

  function handleTurnComplete(turnSessionId: string) {
    const sessionId = activeSessionIdRef.current;
    if (turnSessionId !== sessionId) {
      // The reply finished after the user had already left that chat (Home
      // or another chat while it was still loading): leaving didn't save it,
      // as it had no finished turn then, so save it now.
      closeChat(turnSessionId).catch(() => {});
      // It may be a new chat that never made it into the list on screen.
      loadChats({ refresh: true });
      return;
    }
    hasNewTurnsRef.current = true;
    const firstMessage = firstMessageRef.current;
    firstMessageRef.current = null;
    // The chat on screen moves to the top showing its latest reply's time
    // — display only, nothing is stored; leaving the chat replaces it with
    // the session's end time. A new chat is listed from its first
    // completed turn, which is when the backend has it.
    const now = new Date().toISOString();
    setChats((prev) => {
      if (!prev) return prev;
      const existing = prev.find((c) => c.session_id === sessionId);
      if (!existing && firstMessage === null) return prev;
      const entry: ChatSummary = existing
        ? { ...existing, updated_at: now }
        : {
            session_id: sessionId,
            agent_id: LISTED_AGENT_ID,
            title: makeTitle(firstMessage ?? ''),
            updated_at: now,
          };
      return [entry, ...prev.filter((c) => c.session_id !== sessionId)];
    });
  }

  function handleFirstMessageSent(text: string) {
    setChatStarted(true);
    setActiveSession(chatPanelRef.current?.getSessionId() ?? null);
    firstMessageRef.current = text;
  }

  function handleToolResults(newResults: Record<string, unknown>, agent?: string) {
    if (agent) setLastActiveAgent(agent);
    const timePeriodOptions = newResults.present_time_period_options as
      | { circuit_reference?: unknown }
      | undefined;
    if (typeof timePeriodOptions?.circuit_reference === 'string') {
      setSelectedCircuitReference(timePeriodOptions.circuit_reference);
    }
    setToolResults((prev) => {
      const merged = { ...prev, ...newResults };

      if ('start_service_order_flow' in newResults) {
        delete merged.update_order_summary;
        delete merged.present_bandwidth_recommendation;
        delete merged.present_commitment_recommendation;
        delete merged.list_connection_endpoint_ports;
        delete merged.filter_ports_by_bandwidth;
        delete merged.search_existing_ports;
        delete merged.list_comcast_port_candidates;
        Object.assign(merged, newResults);
      }
      // A transient backend hiccup on a background refresh (e.g.
      // list_active_circuits re-fetched after a boost) shouldn't wipe out
      // an already-good circuit list with an empty one — that would blank
      // out the left panel's detail card over a temporary failure that has
      // nothing to do with the data actually changing. Keep the last
      // known-good list_active_circuits result if the new one came back
      // empty.
      const prevCircuits = circuitsArray(prev.list_active_circuits);
      const newCircuits = circuitsArray(newResults.list_active_circuits);
      if (prevCircuits.length > 0 && newCircuits.length === 0) {
        merged.list_active_circuits = prev.list_active_circuits;
      }
      // The opposite case for ai_analysis_utilization/ai_analysis_jitter
      // (Service Observability Agent): each is generated fresh alongside
      // get_circuit_telemetry every time, never independently. If this
      // turn's tool_results has a new get_circuit_telemetry but no fresh
      // analysis for one (or both) metrics (e.g. that generation call
      // failed just this once, or the metric is unavailable this time),
      // drop any leftover analysis from a previous, different reading
      // rather than showing it stale next to the new numbers.
      if ('get_circuit_telemetry' in newResults) {
        if (!('ai_analysis_utilization' in newResults)) delete merged.ai_analysis_utilization;
        if (!('ai_analysis_jitter' in newResults)) delete merged.ai_analysis_jitter;
      }
      // Same reasoning for ai_config_review (Service Configuration Agent):
      // generated fresh alongside get_connection_details every time, never
      // independently — drop a leftover review from a previously-viewed
      // circuit if this turn refreshed the details but didn't produce a
      // new review for them.
      if ('get_connection_details' in newResults && !('ai_config_review' in newResults)) {
        delete merged.ai_config_review;
      }
      return merged;
    });
  }

  function sendSamplePrompt(text: string) {
    // No explicit setChatStarted(true) here — ChatPanel's send()
    // (which sendMessage below calls into) fires onFirstMessageSent itself
    // the same way a typed Enter/Send does, so this stays a single code
    // path for "the session's first message was sent" regardless of how.
    chatPanelRef.current?.sendMessage(text);
  }

  // Pointer capture (rather than window-level mousemove listeners) keeps
  // delivering move/up events to the divider even once the pointer leaves
  // its thin hit area mid-drag — the standard resizable-pane pattern.
  function handleDividerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  }

  function handleDividerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const percent = ((rect.right - e.clientX) / rect.width) * 100;
    const clamped = Math.min(MAX_RIGHT_WIDTH_PERCENT, Math.max(MIN_RIGHT_WIDTH_PERCENT, percent));
    setRightWidthPercent(clamped);
  }

  function handleDividerPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  }

  return (
    <div className="chat-screen-page">
      <Navbar
      chatStarted={chatStarted}
      onNewChat={handleNewChat}
      language={language}
      onLanguageChange={setLanguage}
      historyOpen={historyOpen}
      // Greyed out only once the list is known to be empty (a new user).
      // While it loads the button looks normal, so a user with history
      // never sees it greyed; a failed load stays clickable to offer a retry.
      historyAvailable={chats === null || chats.length > 0 || chatsLoadFailed}
      onToggleHistory={() => {
        setHistoryError(null);
        if (!historyOpen) loadChats({ refresh: true });
        setHistoryOpen((open) => !open);
      }}
    />

    <div
      className="agent-screen-body"
      ref={bodyRef}
      style={{
        gridTemplateColumns: [
          historyOpen ? HISTORY_PANEL_WIDTH : null,
          chatStarted ? `1fr 6px ${rightWidthPercent}%` : '1fr',
        ]
          .filter(Boolean)
          .join(' '),
      }}
    >
      {historyOpen && (
        <ChatHistoryPanel
          chats={chats ?? []}
          loading={chats === null}
          loadFailed={chatsLoadFailed}
          onRetry={() => loadChats()}
          activeSessionId={activeSessionId}
          disabled={openingChat}
          errorMessage={historyError}
          onSelect={handleOpenChat}
          onRename={handleRenameChat}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <section
        className={`agent-screen-right${
          chatStarted ? '' : ' agent-screen-right--welcome'
        }`}
      >
        {!chatStarted && (
          <div className="chat-welcome-copy">
            <h1>
              <Trans
                i18nKey="welcome.heading"
                components={{ brand: <span className="chat-welcome-brand" /> }}
              />
            </h1>
            <p>{t('welcome.subheading')}</p>
          </div>
        )}

        {chatStarted && (
          <ChatMenuBar activeAgent={lastActiveAgent} />
        )}

        <ChatPanel
          key={chatInstance}
          ref={chatPanelRef}
          language={language}
          variant={chatStarted ? 'default' : 'welcome'}
          autoGreet={false}
          onToolResults={handleToolResults}
          onCircuitSelect={setSelectedCircuitReference}
          renderBeforeMessage={renderChatExtra}
          onFirstMessageSent={handleFirstMessageSent}
          onTurnComplete={handleTurnComplete}
          initialSessionId={restoredChat?.sessionId}
          initialMessages={restoredChat?.messages}
        />

        {!chatStarted && (
          <div className="chat-welcome-prompts">
            {SAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt.labelKey}
                type="button"
                className="chat-welcome-prompt"
                onClick={() => sendSamplePrompt(prompt.text)}
              >
                {t(prompt.labelKey)}
              </button>
            ))}
          </div>
        )}
      </section>

      {chatStarted && (
        <>
          <div
            className={`agent-screen-divider${
              isDragging ? ' is-dragging' : ''
            }`}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            onDoubleClick={() =>
              setRightWidthPercent(DEFAULT_RIGHT_WIDTH_PERCENT)
            }
            role="separator"
            aria-orientation="vertical"
            aria-label={t('chat.resizePanels')}
            title={t('chat.resizeTooltip')}
          />

          <section className="agent-screen-left">
            <div className="agent-screen-left-header">
              {t('infoCanvas.title')}
            </div>

            <div className="agent-screen-left-body">
              <UnifiedLeftPanel
                toolResults={toolResults}
                lastActiveAgent={lastActiveAgent}
                selectedCircuitReference={selectedCircuitReference}
              />
            </div>
          </section>
        </>
      )}
    </div>
  </div>
  );
}
