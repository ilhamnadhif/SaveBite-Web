"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { bankLabel, bankVerified, formatRupiah, type BankAccount, type BankAccountStatus } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { IconButton, PrimaryButton, TextButton } from "../../ui/buttons";
import { AppCard, Divider, FieldLabel, Gap, Wrap } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { SheetSurface, showSheet, snack } from "../../ui/overlays";
import { C, SHEET_BARRIER, display, ellipsis, ui, withAlpha } from "../../ui/theme";

/** `TextButton.styleFrom(visualDensity: VisualDensity.compact)`: 56×32 inside a 40px tap target. */
const COMPACT_TEXT_BUTTON: CSSProperties = { minHeight: 32, minWidth: 56, margin: "4px 0" };

/**
 * The add-account form uses plain Material 3 fields (the app theme has no
 * `inputDecorationTheme`). These are the roles of the theme's seed scheme,
 * `ColorScheme.fromSeed(seedColor: AppColors.green, …)`.
 */
const M3_ON_SURFACE_VARIANT = "#404944";
const M3_ERROR = "#BA1A1A";
/** `onSurface` @ 38%: disabled decoration. */
const M3_DISABLED = "rgba(23, 29, 26, 0.38)";
/** `DropdownButton` arrow (`Colors.grey.shade700`, `.shade400` when disabled). */
const DROPDOWN_ICON = "#616161";
const DROPDOWN_ICON_DISABLED = "#BDBDBD";
/** `ThemeData.disabledColor` (black38): a disabled dropdown's text. */
const DROPDOWN_TEXT_DISABLED = "rgba(0, 0, 0, 0.38)";

/** Hint text colours (`InputDecoration.hintStyle` defaults); CSS owns `::placeholder`. */
const M3_FIELD_CSS = `.sb-m3-field::placeholder{color:${M3_ON_SURFACE_VARIANT};opacity:1}.sb-m3-field:disabled::placeholder{color:${M3_DISABLED}}`;

/**
 * An unfilled underline field: 48px container (the prefix icon's minimum
 * size), content padding 8 above and below a top-aligned 24px text line.
 */
const M3_CONTROL: CSSProperties = {
  display: "block",
  width: "100%",
  height: 48,
  margin: 0,
  border: 0,
  borderRadius: 0,
  outline: "none",
  background: "transparent",
  padding: "8px 0 16px 48px",
  opacity: 1,
};

/** Banks offered by the add-account form, code → display name. */
const BANKS = {
  BCA: "BCA",
  MANDIRI: "Bank Mandiri",
  BNI: "BNI",
  BRI: "BRI",
  BSI: "Bank Syariah Indonesia",
  PERMATA: "Bank Permata",
  CIMB: "CIMB Niaga",
} as const;

type BankCode = keyof typeof BANKS;

const BANK_CODES: readonly BankCode[] = ["BCA", "MANDIRI", "BNI", "BRI", "BSI", "PERMATA", "CIMB"];

const isBankCode = (value: string): value is BankCode => Object.prototype.hasOwnProperty.call(BANKS, value);

const VERIFICATION: Record<BankAccountStatus, { label: string; icon: IconName; color: string }> = {
  verified: { label: "Terverifikasi", icon: "verified_rounded", color: C.greenAccent },
  rejected: { label: "Ditolak", icon: "error_outline_rounded", color: C.danger },
  disabled: { label: "Dinonaktifkan", icon: "block_rounded", color: C.muted },
  pending: { label: "Menunggu verifikasi", icon: "schedule_rounded", color: C.terracotta },
};

/** `State.mounted` for async work that finishes after the sheet is gone. */
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

/** Opens the new bank account form; resolves the saved account, or undefined. */
export function showAddBankAccountSheet(): Promise<BankAccount | undefined> {
  return showSheet<BankAccount>((close) => <AddBankAccountSheet close={close} />, {
    barrierColor: SHEET_BARRIER,
    label: "Tambah rekening",
  });
}

/** C8 Withdraw funds. A withdrawal creates a payout request with status pending. */
export function WithdrawSheet({ close }: { close: (amount?: number) => void }) {
  const state = useAppState();
  const [amountIndex, setAmountIndex] = useState(2);
  const alive = useAlive();
  const amountId = useId();

  const fee = state.businessConfig.withdrawalFee;
  const minimum = state.businessConfig.minimumWithdrawal;
  const choices: ReadonlyArray<{ label: string; amount: number }> = [
    { label: "Rp500rb", amount: 500000 },
    { label: "Rp1jt", amount: 1000000 },
    { label: "Semua saldo", amount: state.balance },
  ];
  const amount = choices[amountIndex].amount;
  const account = state.selectedBankAccount;
  const validAmount = amount >= minimum && amount <= state.balance;
  const canSubmit = validAmount && account !== null && bankVerified(account);

  const addBank = async () => {
    const added = await showAddBankAccountSheet();
    if (added && alive.current) {
      snack("Rekening ditambahkan dan sedang diverifikasi.", "schedule_rounded");
    }
  };

  const showBankPicker = async () => {
    await showSheet<void>((closePicker) => <BankPickerSheet close={closePicker} onAddBank={() => void addBank()} />, {
      barrierColor: SHEET_BARRIER,
      label: "Pilih rekening",
    });
  };

  return (
    <SheetSurface padding="14px 24px 24px">
      <Gap h={6} />
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2 style={{ ...display(22, { weight: 800 }), flex: 1, minWidth: 0 }}>Ajukan penarikan</h2>
        <IconButton tooltip="Tutup" icon="close_rounded" onTap={() => close()} />
      </div>
      <Gap h={14} />
      <SheetBalanceCard balance={state.balance} />
      <Gap h={20} />
      <FieldLabel htmlFor={amountId}>Jumlah penarikan</FieldLabel>
      <output
        id={amountId}
        style={{
          display: "block",
          width: "100%",
          padding: "14px 16px",
          background: C.white,
          borderRadius: 14,
          border: `1.5px solid ${C.greenBright}`,
          ...display(20),
        }}
      >
        {formatRupiah(amount)}
      </output>
      <Gap h={8} />
      <Wrap spacing={8} runSpacing={8}>
        {choices.map((choice, i) => (
          <AmountChip
            key={choice.label}
            label={choice.label}
            selected={amountIndex === i}
            enabled={choice.amount >= minimum && choice.amount <= state.balance}
            onTap={() => setAmountIndex(i)}
          />
        ))}
      </Wrap>
      {!validAmount ? (
        <>
          <Gap h={8} />
          <div style={ui(12, { color: C.danger })}>
            {state.balance < minimum
              ? `Saldo minimum untuk penarikan adalah ${formatRupiah(minimum)}.`
              : "Pilihan jumlah melebihi saldo tersedia."}
          </div>
        </>
      ) : null}
      <Gap h={20} />
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel>Rekening tujuan</FieldLabel>
        </div>
        <TextButton
          label="Tambah"
          icon="add_rounded"
          iconSize={17}
          color={C.greenBright}
          onTap={() => void addBank()}
          style={COMPACT_TEXT_BUTTON}
        />
      </div>
      <BankCard account={account} onTap={() => void showBankPicker()} />
      <Gap h={16} />
      <FeeSummary amount={amount} fee={fee} />
      <Gap h={20} />
      <PrimaryButton
        merchant
        label={
          canSubmit
            ? `Ajukan ${formatRupiah(amount)}`
            : account === null
              ? "Tambahkan rekening dahulu"
              : bankVerified(account)
                ? "Jumlah belum memenuhi syarat"
                : "Rekening belum terverifikasi"
        }
        onTap={canSubmit ? () => close(amount) : null}
      />
    </SheetSurface>
  );
}

function SheetBalanceCard({ balance }: { balance: number }) {
  return (
    <div style={{ width: "100%", padding: "16px 18px", background: C.green, borderRadius: 18 }}>
      <div style={ui(12.5, { color: C.greenMuted })}>Saldo tersedia</div>
      <div style={display(28, { color: C.cream })}>{formatRupiah(balance)}</div>
    </div>
  );
}

/**
 * Material 3 `ChoiceChip` (flat): 8px radius, 1px side, 16px horizontal
 * padding, centred in a 48px tap target. A disabled unselected chip has no
 * fill, and the whole chip is dimmed by the `Opacity` around it.
 */
function AmountChip({
  label,
  selected,
  enabled,
  onTap,
}: {
  label: string;
  selected: boolean;
  enabled: boolean;
  onTap: () => void;
}) {
  return (
    <div style={{ opacity: enabled ? 1 : 0.45, minHeight: 48, display: "flex", alignItems: "center" }}>
      <button
        type="button"
        className="sb-ink"
        aria-pressed={selected}
        disabled={!enabled}
        onClick={enabled ? onTap : undefined}
        style={{
          padding: "7px 15px",
          borderRadius: 8,
          border: `1px solid ${selected ? C.green : C.chipBorder}`,
          backgroundColor: selected ? C.green : enabled ? C.white : C.transparent,
          whiteSpace: "nowrap",
          transition: "background-color 150ms ease, border-color 150ms ease",
          ...ui(12.5, { weight: selected ? 700 : 600, color: selected ? C.white : C.body2, height: 1.43 }),
        }}
      >
        {label}
      </button>
    </div>
  );
}

function BankCard({ account, onTap }: { account: BankAccount | null; onTap: () => void }) {
  if (account === null) {
    return (
      <AppCard radius={14}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <Icon name="account_balance_outlined" color={C.muted} size={30} />
          <Gap h={8} />
          <div style={ui(13.5, { weight: 700, color: C.ink })}>Belum ada rekening</div>
          <Gap h={4} />
          <div style={ui(12, { color: C.muted })}>Tambahkan rekening atas nama pemilik toko.</div>
        </div>
      </AppCard>
    );
  }

  return (
    <button
      type="button"
      className="sb-ink"
      aria-haspopup="dialog"
      onClick={onTap}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        padding: "13px 15px",
        backgroundColor: C.white,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <BankIcon code={account.bankCode} />
      <span
        style={{ flex: 1, minWidth: 0, marginLeft: 12, display: "flex", flexDirection: "column", alignItems: "flex-start" }}
      >
        <span style={ui(13.5, { weight: 700, color: C.ink })}>{bankLabel(account)}</span>
        <span style={{ ...ui(12, { color: C.muted }), marginTop: 2 }}>{account.accountHolder}</span>
        <span style={{ display: "flex", marginTop: 5 }}>
          <VerificationBadge account={account} />
        </span>
      </span>
      <Icon name="expand_more_rounded" color={C.muted} style={{ marginLeft: 8 }} />
    </button>
  );
}

function FeeSummary({ amount, fee }: { amount: number; fee: number }) {
  const net = amount > fee ? amount - fee : 0;
  return (
    <AppCard radius={14}>
      <SummaryLine label="Jumlah diajukan" value={formatRupiah(amount)} />
      <Gap h={10} />
      <SummaryLine label="Biaya admin" value={`−${formatRupiah(fee)}`} />
      <Gap h={12} />
      <Divider color={C.divider} />
      <Gap h={12} />
      <SummaryLine label="Estimasi diterima" value={formatRupiah(net)} bold />
    </AppCard>
  );
}

function SummaryLine({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span style={{ ...ui(13, { weight: bold ? 700 : 500, color: bold ? C.ink : C.body }), flex: 1, minWidth: 0 }}>
        {label}
      </span>
      <span
        style={{
          ...ui(13.5, { weight: bold ? 800 : 600, color: bold ? C.greenAccent : C.ink }),
          flex: "none",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function BankIcon({ code }: { code: string }) {
  return (
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
      {code.length > 4 ? code.substring(0, 4) : code}
    </span>
  );
}

function VerificationBadge({ account }: { account: BankAccount }) {
  const { label, icon, color } = VERIFICATION[account.status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Icon name={icon} size={14} color={color} />
      <span style={ui(10.5, { weight: 700, color })}>{label}</span>
    </span>
  );
}

/** The destination account picker opened from the withdraw sheet. */
function BankPickerSheet({ close, onAddBank }: { close: () => void; onAddBank: () => void }) {
  const state = useAppState();
  const alive = useAlive();

  const choose = async (bank: BankAccount) => {
    try {
      await appState.setBankAccount(bank);
      if (alive.current) close();
    } catch (error) {
      if (!(error instanceof BackendException)) throw error;
      if (alive.current) snack(error.message, "error_outline_rounded");
    }
  };

  return (
    <SheetSurface
      padding="14px 24px 24px"
      style={{
        // Not scroll-controlled: at most 9/16 of the screen height.
        maxHeight: "calc(100dvh * 9 / 16)",
        // The SafeArea inside the padded container adds the bottom inset again.
        paddingBottom: "calc(24px + var(--safe-bottom) + var(--safe-bottom))",
      }}
    >
      <Gap h={12} />
      <h2 style={display(20, { weight: 800 })}>Pilih rekening</h2>
      <Gap h={12} />
      {state.bankAccountRecords.map((bank) => {
        const selected = state.selectedBank === bankLabel(bank);
        return (
          <button
            key={bank.id}
            type="button"
            className="sb-ink"
            aria-pressed={selected}
            onClick={() => void choose(bank)}
            style={{
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              padding: "11px 0",
              borderRadius: 12,
            }}
          >
            <BankIcon code={bank.bankCode} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            >
              <span style={ui(13.5, { weight: 700, color: C.ink })}>{bankLabel(bank)}</span>
              <span style={{ display: "flex", marginTop: 4 }}>
                <VerificationBadge account={bank} />
              </span>
            </span>
            {selected ? <Icon name="check_rounded" size={20} color={C.greenBright} /> : null}
          </button>
        );
      })}
      <Gap h={8} />
      <TextButton
        label="Tambah rekening lain"
        icon="add_rounded"
        color={C.greenBright}
        onTap={() => {
          close();
          onAddBank();
        }}
        style={{ alignSelf: "flex-start" }}
      />
    </SheetSurface>
  );
}

type FieldErrors = { accountNumber: string | null; accountHolder: string | null };

function AddBankAccountSheet({ close }: { close: (account?: BankAccount) => void }) {
  const [bankCode, setBankCode] = useState<BankCode>(BANK_CODES[0]);
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({ accountNumber: null, accountHolder: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const holderInput = useRef<HTMLInputElement | null>(null);
  const alive = useAlive();
  const bankId = useId();
  const numberId = useId();
  const holderId = useId();

  // FilteringTextInputFormatter.digitsOnly + LengthLimitingTextInputFormatter(20).
  const changeAccountNumber = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    if (digits.length <= 20) setAccountNumber(digits);
    else if (accountNumber.length !== 20) setAccountNumber(digits.slice(0, 20));
    // Already at the limit: the old value stays.
  };

  const validate = (): boolean => {
    const digits = accountNumber.trim();
    const holderLength = accountHolder.trim().length;
    const next: FieldErrors = {
      accountNumber: digits.length < 6 || digits.length > 20 ? "Masukkan 6–20 digit nomor rekening." : null,
      accountHolder: holderLength < 2 || holderLength > 100 ? "Nama pemilik harus berisi 2–100 karakter." : null,
    };
    setFieldErrors(next);
    return next.accountNumber === null && next.accountHolder === null;
  };

  const save = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (busyRef.current || !validate()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const account = await appState.saveBankAccount({
        bankCode,
        bankName: BANKS[bankCode],
        accountNumber: accountNumber.trim(),
        accountHolder: accountHolder.trim(),
      });
      if (alive.current) close(account);
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof BackendException ? caught.message : "Rekening belum dapat disimpan. Coba lagi.");
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <SheetSurface padding="14px 24px 24px">
      <style>{M3_FIELD_CSS}</style>
      <Gap h={8} />
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2 style={{ ...display(21, { weight: 800 }), flex: 1, minWidth: 0 }}>Tambah rekening</h2>
        <IconButton tooltip="Tutup" icon="close_rounded" onTap={busy ? null : () => close()} />
      </div>
      <Gap h={12} />
      <FieldLabel htmlFor={bankId}>Bank</FieldLabel>
      <BankDropdown id={bankId} value={bankCode} disabled={busy} onChange={setBankCode} />
      <Gap h={16} />
      <FieldLabel htmlFor={numberId}>Nomor rekening</FieldLabel>
      <M3TextField
        id={numberId}
        icon="numbers_rounded"
        value={accountNumber}
        onChange={changeAccountNumber}
        error={fieldErrors.accountNumber}
        disabled={busy}
        hintText="Contoh: 1234567890"
        inputMode="numeric"
        enterKeyHint="next"
        autoComplete="off"
        // TextInputAction.next moves focus to the next field.
        onSubmitted={() => holderInput.current?.focus()}
      />
      <Gap h={16} />
      <FieldLabel htmlFor={holderId}>Nama pemilik rekening</FieldLabel>
      <M3TextField
        id={holderId}
        inputRef={holderInput}
        icon="person_outline_rounded"
        value={accountHolder}
        onChange={setAccountHolder}
        error={fieldErrors.accountHolder}
        disabled={busy}
        hintText="Sesuai nama pada rekening"
        enterKeyHint="done"
        autoComplete="name"
        autoCapitalize="characters"
        maxLength={100}
        onSubmitted={() => void save()}
      />
      {error !== null ? (
        <>
          <Gap h={12} />
          <div role="alert" style={ui(12.5, { color: C.danger })}>
            {error}
          </div>
        </>
      ) : null}
      <Gap h={20} />
      <PrimaryButton merchant label={busy ? "Menyimpan…" : "Simpan rekening"} onTap={busy ? null : () => void save()} />
    </SheetSurface>
  );
}

/** Underline, prefix icon, and error line of an unfilled Material 3 `InputDecorator`. */
function M3Decorator({
  icon,
  focused,
  disabled,
  error = null,
  errorId,
  trailing,
  children,
}: {
  icon: IconName;
  focused: boolean;
  disabled: boolean;
  error?: string | null;
  errorId?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const active = focused && !disabled;
  const line = disabled ? M3_DISABLED : error ? M3_ERROR : focused ? C.green : M3_ON_SURFACE_VARIANT;
  return (
    <div>
      <div style={{ position: "relative", height: 48 }}>
        {children}
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Icon name={icon} color={disabled ? M3_DISABLED : M3_ON_SURFACE_VARIANT} />
        </span>
        {trailing}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: active ? 2 : 1,
            background: line,
            pointerEvents: "none",
            transition: "height 167ms ease, background-color 167ms ease",
          }}
        />
      </div>
      {error ? (
        <div
          id={errorId}
          role="alert"
          style={{
            ...ui(12, { weight: 400, color: M3_ERROR, height: 1.33, letterSpacing: 0.4 }),
            ...ellipsis,
            paddingTop: 4,
            animation: "sb-fade-in 167ms ease-out both",
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** A plain Material 3 `TextFormField` with a prefix icon and hint text. */
function M3TextField({
  id,
  inputRef,
  icon,
  value,
  onChange,
  error,
  disabled,
  hintText,
  inputMode,
  enterKeyHint,
  autoComplete,
  autoCapitalize,
  maxLength,
  onSubmitted,
}: {
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  icon: IconName;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
  hintText: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  enterKeyHint?: InputHTMLAttributes<HTMLInputElement>["enterKeyHint"];
  autoComplete?: string;
  autoCapitalize?: string;
  maxLength?: number;
  onSubmitted: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const errorId = `${id}-error`;
  const color = disabled ? withAlpha(C.ink, 0.38) : C.ink;
  return (
    <M3Decorator icon={icon} focused={focused} disabled={disabled} error={error} errorId={errorId}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="sb-m3-field"
        value={value}
        disabled={disabled}
        placeholder={hintText}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={false}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSubmitted();
        }}
        style={{
          ...M3_CONTROL,
          ...ui(16, { weight: 400, color, height: 1.5, letterSpacing: 0.5 }),
          WebkitTextFillColor: color,
        }}
      />
    </M3Decorator>
  );
}

/** `DropdownButtonFormField` of bank codes (the native picker opens the menu). */
function BankDropdown({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: BankCode;
  disabled: boolean;
  onChange: (value: BankCode) => void;
}) {
  const [focused, setFocused] = useState(false);
  const color = disabled ? DROPDOWN_TEXT_DISABLED : C.ink;
  return (
    <M3Decorator
      icon="account_balance_outlined"
      focused={focused}
      disabled={disabled}
      trailing={
        <span aria-hidden style={{ position: "absolute", top: 12, right: 0, pointerEvents: "none" }}>
          <Icon name="arrow_drop_down" color={disabled ? DROPDOWN_ICON_DISABLED : DROPDOWN_ICON} />
        </span>
      }
    >
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (isBankCode(event.target.value)) onChange(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...M3_CONTROL,
          paddingRight: 24,
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          cursor: disabled ? "default" : "pointer",
          ...ui(16, { weight: 500, color, height: 1.5, letterSpacing: 0.15 }),
          WebkitTextFillColor: color,
        }}
      >
        {BANK_CODES.map((code) => (
          <option key={code} value={code}>
            {BANKS[code]}
          </option>
        ))}
      </select>
    </M3Decorator>
  );
}
