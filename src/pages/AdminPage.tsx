import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { approveTicket, fetchPendingTickets, fetchTicketHistory } from '../api/client';
import type { ServiceOrderTicket } from '../api/types';
import '../styles/naas.css';

type Tab = 'pending' | 'history';

// Ethernet Connection tickets have two distinct sites (no single
// city/country/post_code), so they show source → destination instead.
function formatAddress(ticket: ServiceOrderTicket): string {
  if (ticket.product_type === 'ethernet_connection') {
    const source = ticket.source_address ?? '—';
    const destination = ticket.destination_address ?? '—';
    return `${source} → ${destination}`;
  }
  return [ticket.city, ticket.country, ticket.post_code].filter(Boolean).join(', ') || '—';
}

// Takes `t` as a parameter rather than calling useTranslation() itself —
// this is a plain function, not a component, so it can't use hooks.
function formatProductType(ticket: ServiceOrderTicket, t: TFunction): string {
  const labels: Record<ServiceOrderTicket['product_type'], string> = {
    ethernet_port: t('admin.productTypes.ethernetPort'),
    offnet_port: t('admin.productTypes.offnetPort'),
    comcast_port: t('admin.productTypes.comcastPort'),
    offnet_modification: t('admin.productTypes.offnetModification'),
    ethernet_connection: t('admin.productTypes.ethernetConnection'),
  };
  return labels[ticket.product_type] ?? t('admin.productTypes.ethernetPort');
}

// Mounted at "/naas/admin" — role-gated the same as the rest of "/naas" (see
// app/router.tsx's RequireRole wrapper), so unlike the pre-BFF version of
// this screen, ticket approval needs no separate per-action login check
// here: reaching this route at all already required NaaS.User/Platform.Admin.
export default function AdminPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<ServiceOrderTicket[]>([]);
  const [history, setHistory] = useState<ServiceOrderTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<ServiceOrderTicket | null>(null);

  function refetch() {
    fetchPendingTickets().then(setPending).catch((err: Error) => setError(err.message));
    fetchTicketHistory().then(setHistory).catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    refetch();
  }, []);

  async function handleApprove(ticketId: number) {
    setApprovingId(ticketId);
    try {
      await approveTicket(ticketId);
      refetch();
      setSelectedTicket((current) => (current?.id === ticketId ? null : current));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  }

  const rows = tab === 'pending' ? pending : history;

  return (
    <div className="admin-page">
      <header className="admin-header">
        <Link to="/naas" className="back-link">
          ← {t('admin.backLink')}
        </Link>
        <h1>{t('admin.title')}</h1>
      </header>

      {error && <p className="admin-error">{error}</p>}

      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === 'pending' ? 'admin-tab--active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {t('admin.pendingTab', { count: pending.length })}
        </button>
        <button
          className={`admin-tab ${tab === 'history' ? 'admin-tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          {t('admin.historyTab', { count: history.length })}
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.table.ticket')}</th>
              <th>{t('admin.table.type')}</th>
              <th>{t('admin.table.address')}</th>
              <th>{t('admin.table.building')}</th>
              <th>{t('admin.table.bandwidth')}</th>
              <th>{t('admin.table.commitment')}</th>
              <th>{t('admin.table.rentalCharge')}</th>
              <th>{tab === 'pending' ? t('admin.table.created') : t('admin.table.approved')}</th>
              {tab === 'pending' && <th className="admin-table__actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={tab === 'pending' ? 9 : 8} className="admin-empty">
                  {tab === 'pending' ? t('admin.noPendingTickets') : t('admin.noHistoryTickets')}
                </td>
              </tr>
            )}
            {rows.map((ticket) => (
              <tr
                key={ticket.id}
                className="admin-table__row"
                onClick={() => setSelectedTicket(ticket)}
              >
                <td>#{ticket.id}</td>
                <td>{formatProductType(ticket, t)}</td>
                <td className="admin-table__address" title={formatAddress(ticket)}>
                  {formatAddress(ticket)}
                </td>
                <td>{ticket.building_name ?? '—'}</td>
                <td>{ticket.bandwidth ?? '—'}</td>
                <td>{ticket.commitment_period ?? '—'}</td>
                <td>{ticket.rental_charge ?? '—'}</td>
                <td>{tab === 'pending' ? ticket.created_at : ticket.approved_at}</td>
                {tab === 'pending' && (
                  <td className="admin-table__actions">
                    <button
                      className="admin-approve-btn"
                      disabled={approvingId === ticket.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleApprove(ticket.id);
                      }}
                    >
                      {approvingId === ticket.id ? t('admin.approving') : t('admin.approve')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedTicket && (
        <div className="admin-modal-backdrop" onClick={() => setSelectedTicket(null)}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <h2>#{selectedTicket.id}</h2>
              <button
                className="admin-modal-close"
                aria-label={t('admin.closeDetails')}
                onClick={() => setSelectedTicket(null)}
              >
                ✕
              </button>
            </div>
            <dl className="admin-modal-fields">
              <div className="admin-modal-field">
                <dt>{t('admin.table.type')}</dt>
                <dd>{formatProductType(selectedTicket, t)}</dd>
              </div>
              <div className="admin-modal-field">
                <dt>{t('admin.table.address')}</dt>
                <dd>{formatAddress(selectedTicket)}</dd>
              </div>
              <div className="admin-modal-field">
                <dt>{t('admin.table.building')}</dt>
                <dd>{selectedTicket.building_name ?? '—'}</dd>
              </div>
              <div className="admin-modal-field">
                <dt>{t('admin.table.bandwidth')}</dt>
                <dd>{selectedTicket.bandwidth ?? '—'}</dd>
              </div>
              <div className="admin-modal-field">
                <dt>{t('admin.table.commitment')}</dt>
                <dd>{selectedTicket.commitment_period ?? '—'}</dd>
              </div>
              <div className="admin-modal-field">
                <dt>{t('admin.table.rentalCharge')}</dt>
                <dd>{selectedTicket.rental_charge ?? '—'}</dd>
              </div>
              <div className="admin-modal-field">
                <dt>{selectedTicket.status === 'pending' ? t('admin.table.created') : t('admin.table.approved')}</dt>
                <dd>
                  {selectedTicket.status === 'pending'
                    ? selectedTicket.created_at
                    : selectedTicket.approved_at}
                </dd>
              </div>
            </dl>
            {selectedTicket.status === 'pending' && (
              <div className="admin-modal-actions">
                <button
                  className="admin-approve-btn"
                  disabled={approvingId === selectedTicket.id}
                  onClick={() => handleApprove(selectedTicket.id)}
                >
                  {approvingId === selectedTicket.id ? t('admin.approving') : t('admin.approve')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
