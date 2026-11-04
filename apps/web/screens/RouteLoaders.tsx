"use client";

/**
 * Deep-link loaders. In the mobile app a screen always receives its object
 * from the screen that pushed it. On the web a refresh or a shared link
 * arrives with only an id in the URL, so these load the object first and then
 * render the very same screen.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { appState } from "../lib/appState";
import { backend } from "../lib/backend";
import { BackendException } from "../lib/backend/types";
import type { Bag, IncomingOrder, Merchant, MerchantBag, OrderRecord, PayoutRequest } from "../lib/models";
import { navigator } from "../lib/navigator";
import { PrimaryButton } from "../ui/buttons";
import { CenteredSpinner, EmptyState, Screen, SimpleHeader } from "../ui/common";
import { CheckoutScreen } from "./consumer/CheckoutScreen";
import { ComplaintScreen } from "./consumer/ComplaintScreen";
import { DetailScreen } from "./consumer/DetailScreen";
import { PaymentFailedScreen } from "./consumer/PaymentFailedScreen";
import { ProcessingScreen } from "./consumer/ProcessingScreen";
import { RatingScreen } from "./consumer/RatingScreen";
import { StoreProfileScreen } from "./consumer/StoreProfileScreen";
import { VoucherScreen } from "./consumer/VoucherScreen";
import { EditBagScreen } from "./merchant/EditBagScreen";
import { OrderDetailScreen } from "./merchant/OrderDetailScreen";
import { WithdrawSuccessScreen } from "./merchant/WithdrawSuccessScreen";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T | null };

function useLoad<T>(load: () => Promise<T | null>): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loader
      .current()
      .then(
        (value) => active && setState({ status: "ready", value }),
        (error: unknown) =>
          active &&
          setState({
            status: "error",
            message: error instanceof BackendException ? error.message : "Data belum dapat dimuat. Periksa koneksi lalu coba lagi.",
          }),
      );
    return () => {
      active = false;
    };
  }, [attempt]);
  return [state, () => setAttempt((value) => value + 1)];
}

function RouteLoader<T>({
  title,
  load,
  missingTitle,
  missingMessage,
  children,
}: {
  title: string;
  load: () => Promise<T | null>;
  missingTitle: string;
  missingMessage: string;
  children: (value: T) => ReactNode;
}) {
  const [state, retry] = useLoad(load);
  if (state.status === "ready" && state.value !== null) return <>{children(state.value)}</>;
  return (
    <Screen>
      <SimpleHeader title={title} />
      {state.status === "loading" ? (
        <CenteredSpinner />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
          <EmptyState
            icon={state.status === "error" ? "cloud_off_outlined" : "search_off"}
            title={state.status === "error" ? "Belum dapat dimuat" : missingTitle}
            message={state.status === "error" ? state.message : missingMessage}
            action={
              state.status === "error" ? (
                <div style={{ width: "100%", maxWidth: 260 }}>
                  <PrimaryButton label="Coba lagi" onTap={retry} />
                </div>
              ) : (
                <div style={{ width: "100%", maxWidth: 260 }}>
                  <PrimaryButton label="Kembali" onTap={() => void navigator.maybePop()} />
                </div>
              )
            }
          />
        </div>
      )}
    </Screen>
  );
}

async function loadBag(bagId: string): Promise<Bag | null> {
  return appState.findBag(bagId) ?? backend().bagById(bagId);
}

async function loadOrder(orderId: string): Promise<OrderRecord | null> {
  const cached = appState.findOrder(orderId);
  if (cached) return cached;
  await appState.loadOrders();
  if (appState.ordersError) throw new BackendException("orders_unavailable", appState.ordersError);
  return appState.findOrder(orderId);
}

async function loadMerchantBag(bagId: string): Promise<MerchantBag | null> {
  const cached = appState.findMerchantBag(bagId);
  if (cached) return cached;
  await appState.loadMerchantData();
  if (appState.merchantError) throw new BackendException("merchant_unavailable", appState.merchantError);
  return appState.findMerchantBag(bagId);
}

async function loadIncomingOrder(orderId: string): Promise<IncomingOrder | null> {
  const cached = appState.findIncomingOrder(orderId);
  if (cached) return cached;
  await appState.loadMerchantData();
  if (appState.merchantError) throw new BackendException("merchant_unavailable", appState.merchantError);
  return appState.findIncomingOrder(orderId);
}

async function loadPayout(requestId: string): Promise<PayoutRequest | null> {
  const cached = appState.findPayoutRequest(requestId);
  if (cached) return cached;
  await appState.loadBalance();
  if (appState.balanceError) throw new BackendException("balance_unavailable", appState.balanceError);
  return appState.findPayoutRequest(requestId);
}

const BAG_MISSING = {
  missingTitle: "Bag tidak tersedia",
  missingMessage: "Bag ini mungkin sudah habis atau tidak lagi dijual hari ini.",
};

const ORDER_MISSING = {
  missingTitle: "Pesanan tidak ditemukan",
  missingMessage: "Pesanan ini tidak ada di akunmu atau sudah tidak tersedia.",
};

export function DetailRoute({ bagId }: { bagId: string }) {
  return (
    <RouteLoader title="Detail bag" load={() => loadBag(bagId)} {...BAG_MISSING}>
      {(bag) => <DetailScreen bag={bag} />}
    </RouteLoader>
  );
}

export function CheckoutRoute({ bagId }: { bagId: string }) {
  return (
    <RouteLoader title="Checkout" load={() => loadBag(bagId)} {...BAG_MISSING}>
      {(bag) => <CheckoutScreen bag={bag} />}
    </RouteLoader>
  );
}

export function ProcessingRoute({ bagId, qty, method }: { bagId: string; qty: number; method: string }) {
  // The idempotency key for (bag, qty, method) is persisted before the first
  // request, so reopening this URL resumes the same reservation.
  return (
    <RouteLoader title="Pembayaran" load={() => loadBag(bagId)} {...BAG_MISSING}>
      {(bag) => <ProcessingScreen bag={bag} qty={qty} method={method} idempotencyKey={null} existingOrder={null} />}
    </RouteLoader>
  );
}

export function PaymentFailedRoute({ bagId, qty, method }: { bagId: string; qty: number; method: string }) {
  return (
    <RouteLoader title="Pembayaran" load={() => loadBag(bagId)} {...BAG_MISSING}>
      {(bag) => <PaymentFailedScreen bag={bag} method={method} qty={qty} idempotencyKey={null} message={null} />}
    </RouteLoader>
  );
}

export function ResumePaymentRoute({ orderId }: { orderId: string }) {
  return (
    <RouteLoader title="Pembayaran" load={() => loadOrder(orderId)} {...ORDER_MISSING}>
      {(order) => (
        <ProcessingScreen
          bag={order.bag}
          qty={order.quantity}
          method={order.paymentMethod}
          idempotencyKey={null}
          existingOrder={order}
        />
      )}
    </RouteLoader>
  );
}

export function VoucherRoute({ orderId }: { orderId: string }) {
  return (
    <RouteLoader title="Voucher pickup" load={() => loadOrder(orderId)} {...ORDER_MISSING}>
      {(order) => <VoucherScreen order={order} />}
    </RouteLoader>
  );
}

export function RatingRoute({ orderId }: { orderId: string }) {
  return (
    <RouteLoader title="Beri ulasan" load={() => loadOrder(orderId)} {...ORDER_MISSING}>
      {(order) => <RatingScreen order={order} />}
    </RouteLoader>
  );
}

export function ComplaintRoute({ orderId }: { orderId: string }) {
  return (
    <RouteLoader title="Ajukan pengaduan" load={() => loadOrder(orderId)} {...ORDER_MISSING}>
      {(order) => <ComplaintScreen order={order} />}
    </RouteLoader>
  );
}

export function StoreProfileRoute({ merchantId }: { merchantId: string }) {
  return (
    <RouteLoader<Merchant>
      title="Profil toko"
      load={() => backend().merchantById(merchantId)}
      missingTitle="Toko tidak ditemukan"
      missingMessage="Toko ini mungkin sudah tidak aktif."
    >
      {(merchant) => <StoreProfileScreen merchant={merchant} />}
    </RouteLoader>
  );
}

export function EditBagRoute({ bagId }: { bagId: string }) {
  return (
    <RouteLoader
      title="Edit bag"
      load={() => loadMerchantBag(bagId)}
      missingTitle="Bag tidak ditemukan"
      missingMessage="Bag ini tidak ada di tokomu."
    >
      {(bag) => <EditBagScreen bag={bag} />}
    </RouteLoader>
  );
}

export function OrderDetailRoute({ orderId }: { orderId: string }) {
  return (
    <RouteLoader title="Detail pesanan" load={() => loadIncomingOrder(orderId)} {...ORDER_MISSING}>
      {(order) => <OrderDetailScreen order={order} />}
    </RouteLoader>
  );
}

export function WithdrawSuccessRoute({ requestId }: { requestId: string }) {
  return (
    <RouteLoader
      title="Penarikan dana"
      load={() => loadPayout(requestId)}
      missingTitle="Penarikan tidak ditemukan"
      missingMessage="Permintaan penarikan ini tidak ada di riwayat saldomu."
    >
      {(request) => <WithdrawSuccessScreen request={request} />}
    </RouteLoader>
  );
}
