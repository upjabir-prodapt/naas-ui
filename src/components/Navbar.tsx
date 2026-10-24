import { History, Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROLE_NAAS_ADMIN } from '../app/config';
import { useAuth } from '@aicoe/aihub-platform/auth';
import LanguageSelect from './LanguageSelect';
import type { Language } from '../i18n/useNaasLanguage';
import logoLight from '../assets/colt-on-demand-logo-white-theme.svg';
import logoDark from '../assets/colt-on-demand-logo-black-theme.svg';

// Persistent top bar for the unified orchestrator experience
// (ChatPage.tsx) — always visible, both on the pre-chat welcome
// screen and once a conversation is under way.
//
// Uses the host app's theme-aware neutral navbar treatment. The app-wide
// Topbar owns theme switching, so this bar only carries chat navigation,
// language, and admin actions.
interface NavbarProps {
  // Whether a conversation is currently under way (ChatPage.tsx's
  // chatStarted) — the "New chat" back button only makes sense once
  // there's actually a session to close.
  chatStarted: boolean;
  // Closes the current session and returns to the welcome screen.
  onNewChat: () => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  // Past-chats panel (ChatHistoryPanel.tsx), shown on the left.
  historyOpen: boolean;
  // False for a user with no chats yet: the button is shown greyed out.
  historyAvailable: boolean;
  onToggleHistory: () => void;
}

export default function Navbar({
  chatStarted,
  onNewChat,
  language,
  onLanguageChange,
  historyOpen,
  historyAvailable,
  onToggleHistory,
}: NavbarProps) {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  // The route itself is guarded too (see router.tsx) — this only stops the
  // link being clickable, so a non-admin is never sent somewhere Apigee will
  // 403 them.
  const canAdminister = hasRole(...ROLE_NAAS_ADMIN);
  return (
    <header className="navbar">
      <div className="navbar-brand">
        <img
          src={logoDark}
          alt={t('navbar.logoAlt')}
          className="navbar-logo navbar-logo--dark"
        />
        <img
          src={logoLight}
          alt={t('navbar.logoAlt')}
          className="navbar-logo navbar-logo--light"
        />
        {chatStarted && (
          <button
            type="button"
            className="navbar-home"
            onClick={onNewChat}
            title={t('navbar.homeTooltip')}
          >
            <Home size={18} />
            {t('navbar.home')}
          </button>
        )}
      </div>

      <div className="navbar-spacer" />
      <div className="navbar-actions">
        {/* aria-disabled rather than disabled: browsers show no tooltip on
            a disabled button, and the tooltip is what explains why. */}
        <button
          type="button"
          className={`navbar-history${historyOpen ? ' is-open' : ''}${
            historyAvailable ? '' : ' is-disabled'
          }`}
          onClick={historyAvailable ? onToggleHistory : undefined}
          aria-disabled={!historyAvailable}
          aria-pressed={historyOpen}
          aria-label={t('history.toggle')}
          title={historyAvailable ? t('history.toggle') : t('history.noHistory')}
        >
          <History size={18} />
        </button>
        <LanguageSelect language={language} onLanguageChange={onLanguageChange} />
        {canAdminister ? (
          <Link to="/naas/admin" className="navbar-admin-link">
            {t('navbar.admin')} →
          </Link>
        ) : (
          <span
            className="navbar-admin-link navbar-admin-link--disabled"
            aria-disabled="true"
            title={t('navbar.adminRequiresRole')}
          >
            {t('navbar.admin')} →
          </span>
        )}
      </div>
    </header>
  );
}
