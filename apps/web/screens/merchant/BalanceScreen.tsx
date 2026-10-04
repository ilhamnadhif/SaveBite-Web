"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import {
  bankLabel,
  bankVerified,
  formatRupiah,
  type BankAccount,
  type BankAccountStatus,
  type PayoutRequest,
  type PayoutStatus,
  type TxRecord,
} from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { OutlinedButton, TextButton } from "../../ui/buttons";
import { AppCard, CenteredSpinner, Gap, RefreshScroll, Screen, Spinner, safeTop } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, argb, clamp, display, ellipsis, ui, withAlpha } from "../../ui/theme";
import { showAddBankAccountSheet } from "./WithdrawSheet";

/** Material 3 `onSurface` @ 38% of the app theme's seed scheme: a disabled button's icon. */
const DISABLED_FOREGROUND = "rgba(23, 29, 26, 0.38)";

/** `TextButton.styleFrom(visualDensity: VisualDensity.compact)`: 56×32 inside a 40px tap target. */
const COMPACT_TEXT_BUTTON: CSSProperties = { minHeight: 32, minWidth: 56, margin: "4px 0" };

const LIST_CARD: CSSProperties = {
  background: C.white,
  borderRadius: 18,
  border: `1px solid ${C.border}`,
  overflow: "hidden",
};

const BANK_STATUS: Record<BankAccountStatus, { label: string; icon: IconName; color: string }> = {
  verified: { label: "Terverifikasi", icon: "verified_rounded", color: C.greenAccent },
  rejected: { label: "Ditolak — periksa kembali data", icon: "error_outline_rounded", color: C.danger },
  disabled: { label: "Dinonaktifkan", icon: "block_rounded", color: C.muted },
  pending: { label: "Menunggu verifikasi", icon: "schedule_rounded", color: C.terracotta },
};

const PAYOUT_STATUS: Record<PayoutStatus, { label: string; color: string; icon: IconName }> = {
  pending: { label: "Menunggu diproses", color: C.terracotta, icon: "schedule_rounded" },
  processing: { label: "Sedang diproses", color: C.greenBright, icon: "sync_rounded" },
  paid: { label: "Sudah ditransfer", color: C.greenBright, icon: "check_circle_rounded" },
  failed: { label: "Gagal", color: C.danger, icon: "error_outline_rounded" },
  cancelled: { label: "Dibatalkan", color: C.muted, icon: "cancel_outlined" },
};

/** `State.mounted` for async work that finishes after the screen is gone. */
function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/** Merchant balance, transaction ledger, bank accounts, and payout requests. */
export function BalanceScreen() {
  const state = useAppState();
  const [withdrawing, setWithdrawing] = useState(false);
  const alive = useAlive();

  const addBank = async () => {
    const account = await showAddBankAccountSheet();
    if (account && alive.current) {
      snack("Rekening ditambahkan dan sedang diverifikasi.", "schedule_rounded");
    }
  };

  const selectBankAccount = async (account: BankAccount) => {
    try {
      await appState.setBankAccount(account);
    } catch (error) {
      if (!(error instanceof BackendException)) throw error;
      if (!alive.current) return;
      snack(error.message, "error_outline_rounded");
    }
  };

  const startWithdrawal = async () => {
    const selected = appState.selectedBankAccount;
    if (selected === null) {
      await addBank();
      return;
    }
    if (!bankVerified(selected)) {
      snack("Pilih rekening yang sudah terverifikasi untuk menarik saldo.", "verified_user_outlined");
      return;
    }

    const amount = await AppNav.showWithdraw();
    if (amount === undefined || !alive.current) return;
    setWithdrawing(true);
    try {
      const request = await appState.withdraw(amount);
      if (!alive.current) return;
      AppNav.toWithdrawSuccess(request);
    } catch (error) {
      if (!alive.current) return;
      const message =
        error instanceof BackendException ? error.message : "Permintaan penarikan belum dapat dibuat. Coba lagi.";
      snack(message, "error_outline_rounded");
    } finally {
      if (alive.current) setWithdrawing(false);
    }
  };

  const selectedAccount = state.selectedBankAccount;

  return (
    <Screen>
      <Header loading={state.isLoadingBalance} />
      {state.isLoadingBalance && state.transactions.length === 0 && state.bankAccountRecords.length === 0 ? (
        <CenteredSpinner />
      ) : (
        <RefreshScroll onRefresh={() => appState.loadBalance()} color={C.terracotta} style={{ padding: "18px 20px 22px" }}>
          {state.balanceError !== null ? (
            <>
              <ErrorCard message={state.balanceError} />
              <Gap h={14} />
            </>
          ) : null}
          <BalanceCard
            balance={state.balance}
            verifiedAccount={selectedAccount !== null && bankVerified(selectedAccount)}
            payoutEnabled={state.businessConfig.payoutsEnabled}
            withdrawing={withdrawing}
            onWithdraw={() => void startWithdrawal()}
          />
          <Gap h={16} />
          <StatRow incomeThisMonth={state.incomeThisMonth} completedBags={state.redeemedBagCount} />
          <Gap h={20} />
          <SectionTitle title="REKENING PENARIKAN" action="Tambah" onAction={() => void addBank()} />
          <Gap h={10} />
          <BankAccountsCard
            accounts={state.bankAccountRecords}
            selectedId={selectedAccount?.id ?? null}
            onAdd={() => void addBank()}
            onSelect={(account) => void selectBankAccount(account)}
          />
          {state.payoutRequests.length > 0 ? (
            <>
              <Gap h={20} />
              <SectionTitle title="PERMINTAAN PENARIKAN" />
              <Gap h={10} />
              <PayoutList payouts={state.payoutRequests} />
            </>
          ) : null}
          <Gap h={20} />
          <SectionTitle title="RIWAYAT TRANSAKSI" />
          <Gap h={10} />
          <TransactionList transactions={state.transactions} />
        </RefreshScroll>
      )}
    </Screen>
  );
}

function Header({ loading }: { loading: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        flex: "none",
        paddingTop: safeTop(14),
        paddingRight: 20,
        paddingBottom: 14,
        paddingLeft: 20,
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <h1 style={{ ...display(24, { weight: 800 }), flex: 1, minWidth: 0 }}>Saldo</h1>
      {loading ? <Spinner size={18} strokeWidth={2} /> : null}
    </div>
  );
}

function BalanceCard({
  balance,
  verifiedAccount,
  payoutEnabled,
  withdrawing,
  onWithdraw,
}: {
  balance: number;
  verifiedAccount: boolean;
  payoutEnabled: boolean;
  withdrawing: boolean;
  onWithdraw: () => void;
}) {
  const enabled = !withdrawing && payoutEnabled;
  const label = withdrawing
    ? "Mengajukan…"
    : !payoutEnabled
      ? "Payout belum diaktifkan"
      : verifiedAccount
        ? "Tarik dana"
        : "Atur rekening penarikan";
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 22, background: C.green }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -20,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: argb(0x40279a6a),
        }}
      />
      <div style={{ position: "relative", padding: 22 }}>
        <div style={ui(13, { color: C.greenMuted })}>Saldo tersedia</div>
        <Gap h={4} />
        <div style={display(36, { weight: 800, color: C.cream })}>
          <span className="sb-sr-only">{`Saldo tersedia ${formatRupiah(balance)}`}</span>
          <span aria-hidden>{formatRupiah(balance)}</span>
        </div>
        <Gap h={16} />
        {/* ElevatedButton.icon(backgroundColor: amber, foregroundColor: green, elevation: 0) */}
        <button
          type="button"
          className="sb-ink"
          disabled={!enabled}
          onClick={enabled ? onWithdraw : undefined}
          style={{
            width: "100%",
            height: 50,
            borderRadius: 14,
            backgroundColor: enabled ? C.amber : withAlpha(C.amber, 150 / 255),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "0 24px 0 16px",
          }}
        >
          {withdrawing ? (
            <Spinner size={17} strokeWidth={2} color={C.green} />
          ) : (
            <Icon name="account_balance_outlined" size={19} color={enabled ? C.green : DISABLED_FOREGROUND} />
          )}
          <span style={{ ...ui(14.5, { weight: 800, color: C.green }), minWidth: 0 }}>{label}</span>
        </button>
      </div>
    </div>
  );
}

function StatRow({ incomeThisMonth, completedBags }: { incomeThisMonth: number; completedBags: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <StatCard label="Pendapatan bulan ini" value={formatRupiah(incomeThisMonth)} valueColor={C.ink} />
      <StatCard label="Bag selesai diambil" value={`${completedBags}`} valueColor={C.greenBright} />
    </div>
  );
}

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 92,
        padding: 14,
        background: C.white,
        borderRadius: 16,
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ ...ui(11.5, { weight: 600, color: C.muted }), ...clamp(2) }}>{label}</div>
      <Gap h={8} />
      <div style={{ ...display(18, { weight: 800, color: valueColor }), ...ellipsis }}>{value}</div>
    </div>
  );
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <h2 style={{ ...ui(12.5, { weight: 700, color: C.muted, letterSpacing: 0.5 }), flex: 1, minWidth: 0 }}>{title}</h2>
      {action !== undefined ? (
        <TextButton label={action} onTap={onAction} color={C.greenBright} style={COMPACT_TEXT_BUTTON} />
      ) : null}
    </div>
  );
}

function BankAccountsCard({
  accounts,
  selectedId,
  onAdd,
  onSelect,
}: {
  accounts: readonly BankAccount[];
  selectedId: string | null;
  onAdd: () => void;
  onSelect: (account: BankAccount) => void;
}) {
  if (accounts.length === 0) {
    return (
      <AppCard radius={18}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <Icon name="account_balance_outlined" size={32} color={C.muted} />
          <Gap h={9} />
          <div style={ui(14, { weight: 700, color: C.ink })}>Belum ada rekening</div>
          <Gap h={4} />
          <div style={ui(12.5, { color: C.body, height: 1.4 })}>
            Tambahkan rekening atas nama pemilik toko untuk mengajukan payout.
          </div>
          <Gap h={12} />
          <OutlinedButton label="Tambah rekening" icon="add_rounded" iconSize={18} onTap={onAdd} />
        </div>
      </AppCard>
    );
  }

  return (
    <div style={LIST_CARD}>
      {accounts.map((account, i) => (
        <BankRow
          key={account.id}
          account={account}
          selected={selectedId === account.id}
          last={i === accounts.length - 1}
          onTap={() => onSelect(account)}
        />
      ))}
    </div>
  );
}

function BankRow({
  account,
  selected,
  last,
  onTap,
}: {
  account: BankAccount;
  selected: boolean;
  last: boolean;
  onTap: () => void;
}) {
  const status = BANK_STATUS[account.status];
  return (
    <button
      type="button"
      className="sb-ink"
      aria-pressed={selected}
      onClick={onTap}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        padding: "13px 14px",
        backgroundColor: selected ? C.greenSoftBg : C.white,
        borderBottom: last ? undefined : `1px solid ${C.divider}`,
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.bca,
          borderRadius: 10,
          ...ui(9.5, { weight: 800, color: C.white }),
        }}
      >
        {account.bankCode.length > 4 ? account.bankCode.substring(0, 4) : account.bankCode}
      </span>
      <span
        style={{ flex: 1, minWidth: 0, marginLeft: 11, display: "flex", flexDirection: "column", alignItems: "flex-start" }}
      >
        <span style={ui(13.5, { weight: 700, color: C.ink })}>{bankLabel(account)}</span>
        <span style={{ ...ui(11.5, { color: C.muted }), marginTop: 2 }}>{account.accountHolder}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
          <Icon name={status.icon} size={14} color={status.color} />
          <span style={ui(10.5, { weight: 700, color: status.color })}>{status.label}</span>
        </span>
      </span>
      {selected ? <Icon name="check_circle_rounded" color={C.greenBright} size={20} /> : null}
    </button>
  );
}

function PayoutList({ payouts }: { payouts: readonly PayoutRequest[] }) {
  return (
    <div style={LIST_CARD}>
      {payouts.map((payout, i) => (
        <PayoutRow key={payout.id} payout={payout} last={i === payouts.length - 1} />
      ))}
    </div>
  );
}

function PayoutRow({ payout, last }: { payout: PayoutRequest; last: boolean }) {
  const { label, color, icon } = PAYOUT_STATUS[payout.status];
  return (
    <div
      style={{
        padding: 14,
        borderBottom: last ? undefined : `1px solid ${C.divider}`,
        display: "flex",
        alignItems: "flex-start",
      }}
    >
      <Icon name={icon} size={20} color={color} />
      <Gap w={10} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={ui(13.5, { weight: 800, color: C.ink })}>{formatRupiah(payout.grossAmount)}</div>
        <Gap h={2} />
        <div style={ui(11.5, { color: C.body })}>
          {`${bankLabel(payout.bankAccount)} · diterima ${formatRupiah(payout.netAmount)}`}
        </div>
        <Gap h={4} />
        <div style={ui(11, { weight: 700, color })}>{label}</div>
      </div>
    </div>
  );
}

function TransactionList({ transactions }: { transactions: readonly TxRecord[] }) {
  if (transactions.length === 0) {
    return (
      <AppCard radius={18}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <Icon name="receipt_long_outlined" color={C.muted} size={32} />
          <Gap h={8} />
          <div style={ui(14, { weight: 700, color: C.ink })}>Belum ada transaksi</div>
          <Gap h={4} />
          <div style={ui(12.5, { color: C.body })}>Pendapatan order dan payout akan tercatat di sini.</div>
        </div>
      </AppCard>
    );
  }
  return (
    <div style={LIST_CARD}>
      {transactions.map((transaction, i) => (
        <TxRow key={transaction.id} transaction={transaction} last={i === transactions.length - 1} />
      ))}
    </div>
  );
}

function TxRow({ transaction, last }: { transaction: TxRecord; last: boolean }) {
  const income = transaction.kind === "income";
  const reversal = transaction.kind === "reversal";
  const incoming = income || reversal;
  const pending = transaction.status === "pending";
  const title =
    transaction.title.trim() === ""
      ? reversal
        ? "Pengembalian saldo payout"
        : income
          ? "Pendapatan order"
          : "Penarikan saldo"
      : transaction.title;
  return (
    <div
      style={{
        padding: "14px 15px",
        borderBottom: last ? undefined : `1px solid ${C.divider}`,
        display: "flex",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: reversal ? C.ratingBg : income ? C.greenSoftBg : C.dangerTintBg,
          borderRadius: 10,
        }}
      >
        <Icon
          name={reversal ? "undo_rounded" : income ? "south_rounded" : "north_rounded"}
          size={18}
          color={reversal ? C.terracotta : income ? C.greenAccent : C.danger}
        />
      </div>
      <Gap w={11} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={ui(13.5, { weight: 700, color: C.ink })}>{title}</div>
        <Gap h={2} />
        <div style={ui(11.5, { color: C.muted })}>{transaction.subtitle}</div>
        {pending ? (
          <>
            <Gap h={4} />
            <div style={ui(10.5, { weight: 700, color: C.terracotta })}>Menunggu diproses</div>
          </>
        ) : null}
      </div>
      <Gap w={10} />
      <div
        style={{
          ...ui(13.5, { weight: 800, color: reversal ? C.terracotta : income ? C.greenAccent : C.ink }),
          flex: "none",
          whiteSpace: "nowrap",
        }}
      >
        {incoming ? `+${formatRupiah(transaction.amount)}` : `−${formatRupiah(transaction.amount)}`}
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div style={{ padding: 13, background: C.dangerTintBg, borderRadius: 14, display: "flex", alignItems: "center" }}>
      <Icon name="error_outline_rounded" color={C.danger} />
      <Gap w={9} />
      <div style={{ ...ui(12.5, { color: C.danger }), flex: 1, minWidth: 0 }}>{message}</div>
      <TextButton label="Coba lagi" onTap={() => void appState.loadBalance()} />
    </div>
  );
}
