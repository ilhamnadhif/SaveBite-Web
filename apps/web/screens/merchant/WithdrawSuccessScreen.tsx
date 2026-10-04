"use client";

import type { CSSProperties } from "react";
import { AppNav } from "../../lib/appNav";
import { bankLabel, formatRupiah, type PayoutRequest } from "../../lib/models";
import { PrimaryButton } from "../../ui/buttons";
import { Divider, Gap, Screen, Scroll, safeBottom, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, display, ui } from "../../ui/theme";

/**
 * Confirms that the payout request was recorded. It does not confirm that the
 * bank or the external provider has transferred the funds.
 */
export function WithdrawSuccessScreen({ request }: { request: PayoutRequest }) {
  return (
    <Screen
      background={C.green}
      style={{ paddingTop: safeTop(24), paddingRight: 24, paddingBottom: safeBottom(20), paddingLeft: 24 }}
    >
      <Scroll>
        <div
          style={{
            // MediaQuery height − safe area − 150.
            minHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 150px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 88,
              height: 88,
              flex: "none",
              borderRadius: "50%",
              background: C.greenBright,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="schedule_rounded" size={42} color={C.white} />
          </div>
          <Gap h={24} />
          <h1 style={{ ...display(24, { color: C.cream }), textAlign: "center" }}>Penarikan diproses</h1>
          <Gap h={10} />
          <p style={{ ...ui(14, { color: C.greenMuted, height: 1.45 }), textAlign: "center" }}>
            Permintaan Anda sedang diproses.
          </p>
          <Gap h={28} />
          <div style={{ alignSelf: "stretch", padding: 18, background: C.white, borderRadius: 18 }}>
            <Row label="Status" value="Menunggu diproses" valueStyle={ui(13.5, { weight: 700, color: C.terracotta })} />
            <Gap h={12} />
            <Row label="Jumlah diajukan" value={formatRupiah(request.grossAmount)} />
            <Gap h={12} />
            <Row label="Biaya admin" value={formatRupiah(request.feeAmount)} />
            <Gap h={14} />
            <Divider color={C.divider} />
            <Gap h={14} />
            <Row
              label="Estimasi diterima"
              value={formatRupiah(request.netAmount)}
              valueStyle={ui(15, { weight: 700, color: C.greenAccent })}
            />
            <Gap h={12} />
            <Row label="Ke rekening" value={bankLabel(request.bankAccount)} />
          </div>
          <Gap h={14} />
          <p style={{ ...ui(11.5, { color: C.greenMuted, height: 1.45 }), textAlign: "center" }}>
            Status akan diperbarui saat penarikan selesai.
          </p>
        </div>
      </Scroll>
      <Gap h={12} />
      <PrimaryButton label="Selesai" background={C.amber} foreground={C.green} onTap={() => void AppNav.back()} />
    </Screen>
  );
}

/**
 * `Row([Expanded(label), SizedBox(16), Flexible(value)])`: both flex 1, so the
 * label always takes half of the free width and the value at most the other
 * half, starting right after the gap.
 */
function Row({ label, value, valueStyle }: { label: string; value: string; valueStyle?: CSSProperties }) {
  const half = "calc((100% - 16px) / 2)";
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <div style={{ ...ui(13.5, { color: C.body }), flex: `0 0 ${half}`, minWidth: 0 }}>{label}</div>
      <Gap w={16} />
      <div
        style={{
          ...(valueStyle ?? ui(13.5, { weight: 600, color: C.ink })),
          flex: "0 1 auto",
          maxWidth: half,
          minWidth: 0,
          textAlign: "right",
          overflowWrap: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}
