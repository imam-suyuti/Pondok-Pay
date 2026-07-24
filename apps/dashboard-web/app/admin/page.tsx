'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { navigationForRole, type DashboardRole } from '../../lib/rbac';
import { getAccessToken, getSessionUser, logoutAuthSession, refreshAuthSession } from '../../lib/auth-session';
import { handleApiError } from '../../lib/api-error';

type SettlementInvoice = {
  id: string;
  periodStart?: string;
  period_start?: string;
  periodEnd?: string;
  period_end?: string;
  closingBalance?: number | string;
  closing_balance?: number | string;
  settlementAction?: string;
  settlement_action?: string;
  status: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const today = () => new Date().toISOString().slice(0, 10);

export default function Admin() {
  const [role, setRole] = useState<DashboardRole>();
  const [merchantId, setMerchantId] = useState('');
  const [periodStart, setPeriodStart] = useState(today());
  const [periodEnd, setPeriodEnd] = useState(today());
  const [invoices, setInvoices] = useState<SettlementInvoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  useEffect(() => {
    const restore = async () => {
      let user = getSessionUser();
      if (!user) {
        const data = await refreshAuthSession(apiBase);
        user = data?.user;
      }
      if (!user) {
        router.replace('/login');
        return;
      }
      setRole(user.role as DashboardRole);
    };
    void restore();
  }, [router]);

  const menu = useMemo(() => (role ? navigationForRole(role) : []), [role]);
  const token = () => getAccessToken();

  async function api(path: string, init: RequestInit = {}) {
    const accessToken = token();
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(handleApiError(payload));
    return payload.data;
  }

  async function loadInvoices() {
    if (!merchantId.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const data = await api(`/v1/merchants/${merchantId.trim()}/settlement-invoices`);
      setInvoices(data.items ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat invoice settlement.');
    } finally {
      setBusy(false);
    }
  }

  async function generateInvoice() {
    if (!merchantId.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await api(`/v1/merchants/${merchantId.trim()}/settlement-invoices/generate`, {
        method: 'POST',
        body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }),
      });
      setMessage('Invoice settlement berhasil dibuat.');
      await loadInvoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal membuat invoice settlement.');
    } finally {
      setBusy(false);
    }
  }

  async function payout(invoice: SettlementInvoice) {
    const amount = Number(invoice.closingBalance ?? invoice.closing_balance ?? 0);
    setBusy(true);
    setMessage('');
    try {
      await api(`/v1/merchants/${merchantId.trim()}/settlement-invoices/${invoice.id}/payout`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      setMessage('Settlement berhasil dicairkan.');
      await loadInvoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal mencairkan settlement.');
    } finally {
      setBusy(false);
    }
  }

  if (!role) return <main style={{ padding: 24 }}>Memuat dashboard…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h1>Dashboard PondokPay</h1>
      <button
        onClick={async () => {
          await logoutAuthSession(apiBase);
          router.replace('/login');
        }}
      >
        Keluar
      </button>
      <p>Selamat datang. Akses menu disesuaikan dengan peran Anda.</p>
      {menu.length ? (
        <nav aria-label="Menu dashboard">
          <ul>{menu.map((m) => <li key={m.label}><button>{m.label}</button></li>)}</ul>
        </nav>
      ) : (
        <p>Peran ini tidak memiliki akses ke dashboard web.</p>
      )}

      {role === 'ADMIN_PESANTREN' && (
        <section style={{ marginTop: 32, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2>Settlement Merchant</h2>
          <p>Masukkan ID merchant untuk melihat invoice dan mencairkan saldo positif.</p>
          <label>
            ID Merchant
            <input
              value={merchantId}
              onChange={(event) => setMerchantId(event.target.value)}
              placeholder="UUID merchant"
              style={{ display: 'block', width: '100%', margin: '4px 0 12px', padding: 8 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label>
              Periode mulai
              <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
            </label>
            <label>
              Periode akhir
              <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={busy || !merchantId} onClick={loadInvoices}>Muat invoice</button>
            <button disabled={busy || !merchantId} onClick={generateInvoice}>Buat invoice periode</button>
          </div>
          {message && <p role="status">{message}</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr>
                <th align="left">Periode</th>
                <th align="right">Saldo akhir</th>
                <th align="left">Status</th>
                <th align="left">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const closingBalance = Number(invoice.closingBalance ?? invoice.closing_balance ?? 0);
                const action = invoice.settlementAction ?? invoice.settlement_action;
                return (
                  <tr key={invoice.id}>
                    <td>{String(invoice.periodStart ?? invoice.period_start)} s.d. {String(invoice.periodEnd ?? invoice.period_end)}</td>
                    <td align="right">Rp{closingBalance.toLocaleString('id-ID')}</td>
                    <td>{invoice.status} / {action}</td>
                    <td>
                      {invoice.status === 'ISSUED' && closingBalance > 0 ? (
                        <button disabled={busy} onClick={() => payout(invoice)}>Cairkan</button>
                      ) : closingBalance <= 0 ? (
                        <span>Dibawa ke periode berikutnya (netting otomatis)</span>
                      ) : (
                        <span>Tidak ada aksi</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
