import { useRef, useState, type KeyboardEvent } from 'react';
import { MessageSquare, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '../api';

interface ChatHistoryPanelProps {
  // The user's chats, newest first — loaded once by NaasChatScreen.tsx and
  // kept up to date there, so opening this panel costs no request.
  chats: ChatSummary[];
  // The list hasn't arrived yet (the panel was opened right after the page).
  loading: boolean;
  // The first load failed: shown with a retry instead of the list.
  loadFailed: boolean;
  onRetry: () => void;
  // The chat currently on screen (highlighted), or null on the welcome screen.
  activeSessionId: string | null;
  // Disabled while a chat is being opened.
  disabled?: boolean;
  // Shown above the list, e.g. when opening or renaming a chat failed.
  errorMessage?: string | null;
  onSelect: (sessionId: string) => void;
  // Resolves once saved; rejects to keep the title being edited.
  onRename: (sessionId: string, title: string) => Promise<void>;
  onClose: () => void;
}

// The signed-in user's chats — Navbar's History button opens it on the left
// of NaasChatScreen.tsx (the Info Canvas stays on the right). Clicking one
// reopens it there and the conversation carries on under the same session;
// the pencil renames it in place.
export default function ChatHistoryPanel({
  chats,
  loading,
  loadFailed,
  onRetry,
  activeSessionId,
  disabled = false,
  errorMessage = null,
  onSelect,
  onRename,
  onClose,
}: ChatHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Each edit ends exactly once: Enter or blur saves, Esc cancels — and the
  // blur that removing the input can fire must not save a cancelled edit.
  const finishedRef = useRef(false);

  function formatDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function startEditing(chat: ChatSummary) {
    finishedRef.current = false;
    setEditingId(chat.session_id);
    setDraft(chat.title);
  }

  async function saveEdit(chat: ChatSummary) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const title = draft.split(/\s+/).filter(Boolean).join(' ');
    if (!title || title === chat.title) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    try {
      await onRename(chat.session_id, title);
      setEditingId(null);
    } catch {
      // Stay in edit mode; the parent shows why.
      finishedRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  function handleEditKeyDown(e: KeyboardEvent<HTMLInputElement>, chat: ChatSummary) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveEdit(chat);
    } else if (e.key === 'Escape') {
      finishedRef.current = true;
      setEditingId(null);
    }
  }

  return (
    <aside className="chat-history" aria-label={t('history.title')}>
      <div className="chat-history-header">
        <span>{t('history.title')}</span>
        <button
          type="button"
          className="chat-history-close"
          onClick={onClose}
          aria-label={t('history.close')}
          title={t('history.close')}
        >
          <X size={16} />
        </button>
      </div>

      <div className="chat-history-body">
        {errorMessage && (
          <p className="chat-history-error" role="alert">
            {errorMessage}
          </p>
        )}
        {loadFailed && (
          <p className="chat-history-empty">
            {t('history.loadFailed')}{' '}
            <button type="button" className="chat-history-retry" onClick={onRetry}>
              {t('history.retry')}
            </button>
          </p>
        )}
        {loading && <p className="chat-history-empty">{t('history.loading')}</p>}
        {!loading && !loadFailed && chats.length === 0 && (
          <p className="chat-history-empty">{t('history.empty')}</p>
        )}
        {!loadFailed && chats.length > 0 && (
          <ul className="chat-history-list">
            {chats.map((chat) => {
              const isActive = chat.session_id === activeSessionId;
              const isEditing = chat.session_id === editingId;
              const date = formatDate(chat.updated_at);
              return (
                <li key={chat.session_id} className="chat-history-row">
                  {isEditing ? (
                    <input
                      className="chat-history-rename-input"
                      value={draft}
                      maxLength={100}
                      autoFocus
                      disabled={saving}
                      aria-label={t('history.renameLabel')}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => handleEditKeyDown(e, chat)}
                      onBlur={() => void saveEdit(chat)}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`chat-history-item${isActive ? ' is-active' : ''}`}
                        onClick={() => onSelect(chat.session_id)}
                        disabled={disabled || isActive}
                        aria-current={isActive ? 'true' : undefined}
                        title={chat.title}
                      >
                        <MessageSquare size={13} className="chat-history-item-icon" />
                        <span className="chat-history-item-text">
                          <span className="chat-history-item-title">
                            {chat.title || t('history.untitled')}
                          </span>
                          <span className="chat-history-item-meta">
                            {/* No time anywhere: an open chat from an earlier
                                visit that was never closed. */}
                            {date || t('history.notSaved')}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="chat-history-rename"
                        onClick={() => startEditing(chat)}
                        aria-label={t('history.rename')}
                        title={t('history.rename')}
                      >
                        <Pencil size={12} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
