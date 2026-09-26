"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, Building2, CircleDollarSign, Plus } from "lucide-react";
import { Metric, PageHeading, Panel, StatusPill, describeError, parseRupiahAmount, useAsyncData } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { makeIdempotencyKey, rupiah, shortDate } from "@savebite/web-shared";

const MIN_WITHDRAWAL = 50_000;
const MAX_TRANSACTIONS = 30;
const MAX_PAYOUTS = 20;

type Bank = { id: string; bank_code: string; bank_name: string; account_holder: string; account_number_last4: string; status: string; is_default: boolean };
type Transaction = { id: string; title: string; subtitle: string; amount: number; kind: string; created_at: string };
type Payout = { id: string; amount: number; fee_amount: number; net_amount: number; status: string; requested_at: string };
type BalanceData = { banks: Bank[]; balance: number; transactions: Transaction[]; payouts: Payout[] };

export default function BalancePage() {
  const [bankForm, setBankForm] = useState({ bank_code: "BCA", account_holder: "", account_number: "" });
  const [amount, setAmount] = useState("");
  const [bankId, setBankId] = useState("");
  const [busy, setBusy] = useState<"register" | "withdraw" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Guards the "pick the first account for me" default so a later reload never
  // overrides a selection the merchant has already made.
  const bankIdTouched = useRef(false);

  const load = async (): Promise<BalanceData> => {
    const db = supabaseBrowser();
    const { data: merchant, error: merchantError } = await db.rpc("get_my_merchant");
    if (merchantError) throw merchantError;
    const id = String((merchant as Record<string, unknown> | null)?.id ?? "");
    if (!id) return { banks: [], balance: 0, transactions: [], payouts: [] };

    const [banks, balance, transactions, payouts] = await Promise.all([
      db.from("my_bank_accounts").select("*").order("is_default", { ascending: false }),
      db.from("merchant_balance").select("available").eq("merchant_id", id).maybeSingle(),
      db.from("transactions").select("*").eq("merchant_id", id).order("created_at", { ascending: false }).limit(MAX_TRANSACTIONS),
      db.from("payout_requests").select("*").eq("merchant_id", id).order("requested_at", { ascending: false }).limit(MAX_PAYOUTS),
    ]);

    // Surfaces a partial failure instead of silently showing a half-empty page.
    const firstError = banks.error ?? balance.error ?? transactions.error ?? payouts.error;
    if (firstError) throw firstError;

    return {
      banks: (banks.data ?? []) as Bank[],
      balance: Number(balance.data?.available ?? 0),
      transactions: (transactions.data ?? []) as Transaction[],
      payouts: (payouts.data ?? []) as Payout[],
    };
  };

  const { data, loading, error: loadError, reload } = useAsyncData<BalanceData>(load, {
    scope: "merchantBalance.load",
    initialData: { banks: [], balance: 0, transactions: [], payouts: [] },
  });

  const { banks, balance, transactions, payouts } = data;

  // Default the payout target to the first account, but never fight the user:
  // once they have chosen, the selection is theirs to keep.
  useEffect(() => {
    if (bankId || !banks.length || bankIdTouched.current) return;
    bankIdTouched.current = true;
    setBankId(banks[0].id);
  }, [bankId, banks]);

  async function register(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const holder = bankForm.account_holder.trim();
    const digits = bankForm.account_number.replace(/\D/g, "");
    if (holder.length < 2) {
      setError("Nama pemilik rekening wajib diisi.");
      return;
    }
    if (digits.length < 6) {
      setError("Nomor rekening tidak valid.");
      return;
    }
    setBusy("register");
    setError("");
    setMessage("");
    try {
      const { error: rpcError } = await supabaseBrowser().rpc("register_bank_account", {
        p_bank_code: bankForm.bank_code,
        p_account_holder: holder.slice(0, 100),
        p_account_number: digits.slice(0, 24),
        p_idempotency_key: makeIdempotencyKey(),
      });
      if (rpcError) throw rpcError;
      setMessage("Rekening disimpan dan menunggu verifikasi.");
      setBankForm({ bank_code: bankForm.bank_code, account_holder: "", account_number: "" });
      reload();
    } catch (caught) {
      setError(describeError(caught, "merchantBalance.registerBank", { bankCode: bankForm.bank_code }));
    } finally {
      setBusy("");
    }
  }

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = parseRupiahAmount(amount);
    if (value === null) {
      setError("Masukkan jumlah penarikan yang valid.");
      return;
    }
    if (value < MIN_WITHDRAWAL) {
      setError(`Minimal penarikan ${rupiah(MIN_WITHDRAWAL)}.`);
      return;
    }
    if (value > balance) {
      setError("Jumlah melebihi saldo tersedia.");
      return;
    }
    const target = banks.find((bank) => bank.id === bankId);
    if (!target) {
      setError("Pilih rekening tujuan.");
      return;
    }
    if (target.status !== "verified") {
      setError("Rekening tujuan belum terverifikasi.");
      return;
    }

    setBusy("withdraw");
    setError("");
    setMessage("");
    try {
      const { error: rpcError } = await supabaseBrowser().rpc("request_withdrawal", {
        p_bank_account_id: bankId,
        p_amount: value,
        p_idempotency_key: makeIdempotencyKey(),
      });
      if (rpcError) throw rpcError;
      setMessage("Permintaan penarikan dibuat.");
      setAmount("");
      reload();
    } catch (caught) {
      setError(describeError(caught, "merchantBalance.withdraw", { amount: value }));
    } finally {
      setBusy("");
    }
  }

  const pendingPayouts = payouts.filter((payout) => ["requested", "processing"].includes(payout.status)).length;

  return <>
    <PageHeading eyebrow="KEUANGAN TOKO" title="Saldo & rekening" description="Lihat pendapatan terverifikasi dan kelola rekening penarikan."/>
    <div className="metric-grid">
      <Metric label="Saldo tersedia" value={rupiah(balance)} hint="Pendapatan dari pickup selesai" icon={<CircleDollarSign size={16}/>}/>
      <Metric label="Rekening tersimpan" value={String(banks.length)} hint="Verifikasi dikelola oleh SaveBite" accent="gold" icon={<Building2 size={16}/>}/>
      <Metric label="Transaksi terbaru" value={String(transactions.length)} hint="Riwayat ledger" accent="terracotta" icon={<ArrowUpRight size={16}/>}/>
      <Metric label="Penarikan diproses" value={String(pendingPayouts)} hint="Menunggu payout provider" icon={<ArrowDownToLine size={16}/>}/>
    </div>

    {loadError && <div className="alert alert-error" role="alert">{loadError} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {message && <div className="alert alert-success" role="status">{message}</div>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}

    <div className="finance-grid">
      <Panel title="Rekening bank">
        <form onSubmit={(event) => void register(event)}>
          <div className="field">
            <label htmlFor="bank-code">Bank</label>
            <select id="bank-code" value={bankForm.bank_code} onChange={(event) => setBankForm({ ...bankForm, bank_code: event.target.value })}>
              {["BCA", "MANDIRI", "BNI", "BRI"].map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="account-holder">Nama pemilik rekening</label>
            <input id="account-holder" value={bankForm.account_holder} onChange={(event) => setBankForm({ ...bankForm, account_holder: event.target.value })} required maxLength={100}/>
          </div>
          <div className="field">
            <label htmlFor="account-number">Nomor rekening</label>
            <input id="account-number" inputMode="numeric" value={bankForm.account_number} onChange={(event) => setBankForm({ ...bankForm, account_number: event.target.value.replace(/\D/g, "").slice(0, 24) })} required maxLength={24}/>
            <small>Nomor rekening disimpan terenkripsi sebagai hash oleh Supabase.</small>
          </div>
          <button className="button button-secondary" disabled={Boolean(busy)}>
            <Plus size={14}/>{busy === "register" ? "Menyimpan…" : "Simpan rekening"}
          </button>
        </form>
        {banks.length > 0 && (
          <div className="bank-account-list">
            {banks.map((bank) => (
              <div className="bank-account" key={bank.id}>
                <span className="bank-logo" aria-hidden="true">{bank.bank_code.slice(0, 1)}</span>
                <div>
                  <strong>{bank.bank_name} ···· {bank.account_number_last4}</strong>
                  <small>{bank.account_holder}</small>
                </div>
                <span className={"status-pill " + (bank.status === "verified" ? "status-ready" : "status-pending")}>
                  {bank.status === "verified" ? "Terverifikasi" : "Menunggu verifikasi"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Ajukan penarikan">
        <form onSubmit={(event) => void withdraw(event)}>
          <div className="field">
            <label htmlFor="payout-bank">Rekening tujuan</label>
            <select
              id="payout-bank"
              value={bankId}
              onChange={(event) => {
                bankIdTouched.current = true;
                setBankId(event.target.value);
              }}
              required
            >
              <option value="">Pilih rekening</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id} disabled={bank.status !== "verified"}>
                  {bank.bank_name} ···· {bank.account_number_last4} ({bank.status})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="payout-amount">Jumlah (minimal {rupiah(MIN_WITHDRAWAL)})</label>
            <input id="payout-amount" type="number" inputMode="numeric" min={MIN_WITHDRAWAL} max={balance} step="1000" value={amount} onChange={(event) => setAmount(event.target.value)} required/>
          </div>
          <div className="withdraw-summary"><span>Saldo tersedia</span><strong>{rupiah(balance)}</strong></div>
          <button className="button button-primary" disabled={Boolean(busy) || !banks.length || loading}>
            <ArrowDownToLine size={14}/>{busy === "withdraw" ? "Mengirim…" : "Ajukan penarikan"}
          </button>
          <small className="withdraw-note">Rekening harus berstatus terverifikasi. Penarikan juga mengikuti konfigurasi payout aktif di backend.</small>
        </form>
      </Panel>
    </div>

    <Panel title="Transaksi terbaru" className="transactions-panel">
      {transactions.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>TRANSAKSI</th><th>WAKTU</th><th>JENIS</th><th>NILAI</th></tr></thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td><div className="strong-cell">{transaction.title}</div><div className="sub-cell">{transaction.subtitle}</div></td>
                  <td>{shortDate(transaction.created_at)}</td>
                  <td><span className={"tx-kind " + transaction.kind}>{transaction.kind === "income" ? "Pendapatan" : "Penarikan"}</span></td>
                  <td className="tx-amount">{transaction.kind === "income" ? "+" : "−"}{rupiah(transaction.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-transactions">Transaksi akan muncul setelah order berhasil di-pickup.</div>
      )}
    </Panel>

    <Panel title="Status penarikan" className="payout-panel">
      {payouts.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>PERMINTAAN</th><th>WAKTU</th><th>STATUS</th><th>DITERIMA</th></tr></thead>
            <tbody>
              {payouts.map((payout) => (
                <tr key={payout.id}>
                  <td>{rupiah(payout.amount)} <small>(biaya {rupiah(payout.fee_amount)})</small></td>
                  <td>{shortDate(payout.requested_at)}</td>
                  <td><StatusPill status={payout.status}/></td>
                  <td>{rupiah(payout.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-transactions">Belum ada permintaan penarikan.</div>
      )}
    </Panel>
  </>;
}
