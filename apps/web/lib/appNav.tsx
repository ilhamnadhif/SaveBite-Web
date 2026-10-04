"use client";

/**
 * The single navigation entry point, ported from `lib/app_nav.dart`. Every
 * cross-feature screen change goes through here so stack resets, role intent,
 * and logout stay consistent. Screens call these instead of the navigator.
 */
import { appState } from "./appState";
import { AuthService } from "./auth";
import { BackendException } from "./backend/types";
import type { AppNotification, Bag, BagFilter, IncomingOrder, Merchant, MerchantBag, OrderRecord, PayoutRequest } from "./models";
import { navigator, type RouteSpec } from "./navigator";
import {
  parseConsumerOrderNotificationRoute,
  parseMerchantOrderNotificationRoute,
  type ConsumerOrdersTab,
  type MerchantOrdersTab,
} from "./notificationRoute";
import { matchRoute, paths, routeSpace, type LegalDocument, type RouteMatch } from "./routes";
import { SHEET_BARRIER } from "../ui/theme";
import { showSheet } from "../ui/overlays";

import { OnboardingScreen } from "../screens/onboarding/OnboardingScreen";
import { ForkScreen } from "../screens/onboarding/ForkScreen";
import { LoginScreen } from "../screens/onboarding/LoginScreen";
import { StartupErrorScreen } from "../screens/onboarding/StartupErrorScreen";
import { ConsumerShell } from "../screens/consumer/ConsumerShell";
import { DetailScreen } from "../screens/consumer/DetailScreen";
import { FilterSheet } from "../screens/consumer/FilterSheet";
import { CheckoutScreen } from "../screens/consumer/CheckoutScreen";
import { ProcessingScreen } from "../screens/consumer/ProcessingScreen";
import { PaymentFailedScreen } from "../screens/consumer/PaymentFailedScreen";
import { VoucherScreen } from "../screens/consumer/VoucherScreen";
import { RatingScreen } from "../screens/consumer/RatingScreen";
import { StoreProfileScreen } from "../screens/consumer/StoreProfileScreen";
import { NotificationsScreen } from "../screens/consumer/NotificationsScreen";
import { EditProfileScreen } from "../screens/consumer/EditProfileScreen";
import { SearchScreen } from "../screens/consumer/SearchScreen";
import { LocationPrimingScreen } from "../screens/consumer/LocationPrimingScreen";
import { MerchantShell } from "../screens/merchant/MerchantShell";
import { StoreSetupScreen } from "../screens/merchant/StoreSetupScreen";
import { CreateBagScreen } from "../screens/merchant/CreateBagScreen";
import { EditBagScreen } from "../screens/merchant/EditBagScreen";
import { OrderDetailScreen } from "../screens/merchant/OrderDetailScreen";
import { ScanQrScreen } from "../screens/merchant/ScanQrScreen";
import { WithdrawSheet } from "../screens/merchant/WithdrawSheet";
import { WithdrawSuccessScreen } from "../screens/merchant/WithdrawSuccessScreen";
import { EditStoreScreen } from "../screens/merchant/EditStoreScreen";
import { MerchantReviewsScreen } from "../screens/merchant/MerchantReviewsScreen";
import { HelpScreen } from "../screens/shared/HelpScreen";
import { LegalScreen } from "../screens/shared/LegalScreen";
import {
  CheckoutRoute,
  DetailRoute,
  EditBagRoute,
  OrderDetailRoute,
  PaymentFailedRoute,
  ProcessingRoute,
  RatingRoute,
  ResumePaymentRoute,
  StoreProfileRoute,
  VoucherRoute,
  WithdrawSuccessRoute,
} from "../screens/RouteLoaders";

const CHECKOUT_ROUTE = "/consumer/checkout";
const PROCESSING_ROUTE = "/consumer/checkout/processing";

// ── Route specs (one per screen) ──────────────────────────────────────────

export const specs = {
  onboarding: (): RouteSpec => ({ url: paths.onboarding(), build: () => <OnboardingScreen /> }),
  fork: (): RouteSpec => ({ url: paths.fork(), build: () => <ForkScreen /> }),
  login: (merchant: boolean, next?: string): RouteSpec => ({
    url: paths.login(merchant, next),
    build: () => <LoginScreen merchant={merchant} next={next} />,
  }),
  startupError: (message: string): RouteSpec => ({
    url: typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`,
    build: () => <StartupErrorScreen message={message} />,
  }),
  consumerShell: (
    options: { initialIndex?: number; initialOrdersTab?: ConsumerOrdersTab; referencedOrderId?: string | null } = {},
  ): RouteSpec => {
    const index = options.initialIndex ?? 0;
    const query =
      index === 2
        ? {
            tab: options.initialOrdersTab === "history" ? "history" : undefined,
            order: options.referencedOrderId ?? undefined,
          }
        : undefined;
    return {
      url: paths.consumerTab(index, query),
      build: () => (
        <ConsumerShell
          initialIndex={index}
          initialOrdersTab={options.initialOrdersTab ?? "active"}
          referencedOrderId={options.referencedOrderId ?? null}
        />
      ),
    };
  },
  merchantShell: (
    options: { initialIndex?: number; initialOrdersTab?: MerchantOrdersTab; referencedOrderId?: string | null } = {},
  ): RouteSpec => {
    const index = Math.max(0, Math.min(4, options.initialIndex ?? 0));
    const query =
      index === 2
        ? {
            tab: options.initialOrdersTab === "closed" ? "closed" : undefined,
            order: options.referencedOrderId ?? undefined,
          }
        : undefined;
    return {
      url: paths.merchantTab(index, query),
      build: () => (
        <MerchantShell
          initialIndex={index}
          initialOrdersTab={options.initialOrdersTab ?? "active"}
          referencedOrderId={options.referencedOrderId ?? null}
        />
      ),
    };
  },
  locationPriming: (): RouteSpec => ({ url: paths.locationPriming(), build: () => <LocationPrimingScreen /> }),
  storeSetup: (): RouteSpec => ({ url: paths.storeSetup(), build: () => <StoreSetupScreen /> }),
  detail: (bag: Bag): RouteSpec => ({ url: paths.detail(bag.id), build: () => <DetailScreen bag={bag} /> }),
  search: (): RouteSpec => ({ url: paths.search(), build: () => <SearchScreen /> }),
  checkout: (bag: Bag): RouteSpec => ({
    url: paths.checkout(bag.id),
    name: CHECKOUT_ROUTE,
    build: () => <CheckoutScreen bag={bag} />,
  }),
  processing: (input: {
    bag: Bag;
    qty: number;
    method: string;
    idempotencyKey?: string | null;
    existingOrder?: OrderRecord | null;
  }): RouteSpec => ({
    url: input.existingOrder ? paths.resumePayment(input.existingOrder.id) : paths.processing(input.bag.id, input.qty, input.method),
    name: PROCESSING_ROUTE,
    build: () => (
      <ProcessingScreen
        bag={input.bag}
        qty={input.qty}
        method={input.method}
        idempotencyKey={input.idempotencyKey ?? null}
        existingOrder={input.existingOrder ?? null}
      />
    ),
  }),
  paymentFailed: (input: {
    bag: Bag;
    method: string;
    qty?: number;
    idempotencyKey?: string | null;
    message?: string | null;
  }): RouteSpec => ({
    url: paths.paymentFailed(input.bag.id, input.qty ?? 1, input.method),
    build: () => (
      <PaymentFailedScreen
        bag={input.bag}
        method={input.method}
        qty={input.qty ?? 1}
        idempotencyKey={input.idempotencyKey ?? null}
        message={input.message ?? null}
      />
    ),
  }),
  voucher: (order: OrderRecord): RouteSpec => ({ url: paths.voucher(order.id), build: () => <VoucherScreen order={order} /> }),
  storeProfile: (merchant: Merchant): RouteSpec => ({
    url: paths.storeProfile(merchant.id),
    build: () => <StoreProfileScreen merchant={merchant} />,
  }),
  rating: (order: OrderRecord): RouteSpec => ({ url: paths.rating(order.id), build: () => <RatingScreen order={order} /> }),
  notifications: (): RouteSpec => ({ url: paths.notifications(), build: () => <NotificationsScreen /> }),
  editProfile: (): RouteSpec => ({ url: paths.editProfile(), build: () => <EditProfileScreen /> }),
  help: (): RouteSpec => ({ url: paths.help(), build: () => <HelpScreen /> }),
  legal: (document: LegalDocument): RouteSpec => ({ url: paths.legal(document), build: () => <LegalScreen document={document} /> }),
  createBag: (): RouteSpec => ({ url: paths.createBag(), build: () => <CreateBagScreen /> }),
  editBag: (bag: MerchantBag): RouteSpec => ({ url: paths.editBag(bag.id), build: () => <EditBagScreen bag={bag} /> }),
  orderDetail: (order: IncomingOrder): RouteSpec => ({
    url: paths.orderDetail(order.id),
    build: () => <OrderDetailScreen order={order} />,
  }),
  editStore: (): RouteSpec => ({ url: paths.editStore(), build: () => <EditStoreScreen /> }),
  merchantReviews: (rootEntry = false): RouteSpec => ({
    url: paths.merchantReviews(),
    build: () => <MerchantReviewsScreen rootEntry={rootEntry} />,
  }),
  scanQr: (): RouteSpec => ({ url: paths.scanQr(), build: () => <ScanQrScreen /> }),
  withdrawSuccess: (request: PayoutRequest): RouteSpec => ({
    url: paths.withdrawSuccess(request.id),
    build: () => <WithdrawSuccessScreen request={request} />,
  }),
};

// ── Deep links ────────────────────────────────────────────────────────────

/** True once a session has been routed into the app (legal/help bases). */
let signedIn = false;

function shellForMode(tab = 0): RouteSpec {
  return appState.mode === "merchant" ? specs.merchantShell({ initialIndex: tab }) : specs.consumerShell({ initialIndex: tab });
}

function intParam(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 99 ? parsed : fallback;
}

/**
 * Rebuilds a stack from a URL: the screen on top of the shell it would have
 * been pushed from, so the back button behaves like the mobile app.
 */
export function restoreStack(url: string): RouteSpec[] | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://savebite.invalid");
  } catch {
    return null;
  }
  const match = matchRoute(parsed.pathname);
  if (!match) return null;
  const query = parsed.searchParams;
  const space = routeSpace(match);
  if (space === "merchant") appState.switchToMerchant();
  else if (space === "consumer") appState.switchToConsumer();
  return stackFor(match, query);
}

function stackFor(match: RouteMatch, query: URLSearchParams): RouteSpec[] {
  const consumer = (tab = 0) => specs.consumerShell({ initialIndex: tab });
  const merchant = (tab = 0) => specs.merchantShell({ initialIndex: tab });
  const method = query.get("method") || "QRIS";
  switch (match.name) {
    case "consumerTab":
      return [
        specs.consumerShell({
          initialIndex: match.tab,
          initialOrdersTab: query.get("tab") === "history" ? "history" : "active",
          referencedOrderId: match.tab === 2 ? query.get("order") : null,
        }),
      ];
    case "merchantTab":
      return [
        specs.merchantShell({
          initialIndex: match.tab,
          initialOrdersTab: query.get("tab") === "closed" ? "closed" : "active",
          referencedOrderId: match.tab === 2 ? query.get("order") : null,
        }),
      ];
    case "onboarding":
      return [specs.onboarding()];
    case "fork":
      return [appState.onboardingSeen ? specs.fork() : specs.onboarding()];
    case "login": {
      const merchantRole = query.get("role") === "merchant";
      return [specs.fork(), specs.login(merchantRole, query.get("next") ?? undefined)];
    }
    case "legal":
      return [signedIn ? shellForMode(4) : specs.fork(), specs.legal(match.document)];
    case "help":
      return [shellForMode(4), specs.help()];
    case "notifications":
      return [shellForMode(0), specs.notifications()];
    case "locationPriming":
      return [specs.locationPriming()];
    case "detail":
      return [consumer(0), { url: paths.detail(match.bagId), build: () => <DetailRoute bagId={match.bagId} /> }];
    case "search":
      return [consumer(0), specs.search()];
    case "checkout":
      return [
        consumer(0),
        { url: paths.checkout(match.bagId), name: CHECKOUT_ROUTE, build: () => <CheckoutRoute bagId={match.bagId} /> },
      ];
    case "processing": {
      const qty = intParam(query.get("qty"), 1);
      return [
        consumer(0),
        {
          url: paths.processing(match.bagId, qty, method),
          name: PROCESSING_ROUTE,
          build: () => <ProcessingRoute bagId={match.bagId} qty={qty} method={method} />,
        },
      ];
    }
    case "paymentFailed": {
      const qty = intParam(query.get("qty"), 1);
      return [
        consumer(0),
        {
          url: paths.paymentFailed(match.bagId, qty, method),
          build: () => <PaymentFailedRoute bagId={match.bagId} qty={qty} method={method} />,
        },
      ];
    }
    case "resumePayment":
      return [
        consumer(2),
        {
          url: paths.resumePayment(match.orderId),
          name: PROCESSING_ROUTE,
          build: () => <ResumePaymentRoute orderId={match.orderId} />,
        },
      ];
    case "voucher":
      return [consumer(2), { url: paths.voucher(match.orderId), build: () => <VoucherRoute orderId={match.orderId} /> }];
    case "rating":
      return [consumer(2), { url: paths.rating(match.orderId), build: () => <RatingRoute orderId={match.orderId} /> }];
    case "storeProfile":
      return [
        consumer(0),
        { url: paths.storeProfile(match.merchantId), build: () => <StoreProfileRoute merchantId={match.merchantId} /> },
      ];
    case "editProfile":
      return [consumer(4), specs.editProfile()];
    case "storeSetup":
      return [specs.storeSetup()];
    case "createBag":
      return [merchant(1), specs.createBag()];
    case "editBag":
      return [merchant(1), { url: paths.editBag(match.bagId), build: () => <EditBagRoute bagId={match.bagId} /> }];
    case "orderDetail":
      return [merchant(2), { url: paths.orderDetail(match.orderId), build: () => <OrderDetailRoute orderId={match.orderId} /> }];
    case "editStore":
      return [merchant(4), specs.editStore()];
    case "merchantReviews":
      return [merchant(4), specs.merchantReviews(false)];
    case "scanQr":
      return [merchant(0), specs.scanQr()];
    case "withdrawSuccess":
      return [
        merchant(3),
        {
          url: paths.withdrawSuccess(match.requestId),
          build: () => <WithdrawSuccessRoute requestId={match.requestId} />,
        },
      ];
  }
}

// ── Auth routing state ────────────────────────────────────────────────────

let signedInFlow: Promise<void> | null = null;
let signedInFlowGeneration: number | null = null;
let signedInHandledIdentity: string | null = null;
let signedOutFlow: Promise<void> | null = null;
let signedOutHandled = false;
let authRoutingGeneration = 0;
/** The URL the app was opened on; honoured once after sign-in. */
let pendingDeepLink: string | null = null;

const ENTRY_PATHS = new Set(["/", "/welcome", "/onboarding", "/login", "/auth/callback"]);

async function currentIdentity(): Promise<string> {
  if (!AuthService.isConfigured) return AuthService.isDemoMode ? "demo" : "local-test";
  const session = await AuthService.currentSession();
  return session?.user.id ?? "local-test";
}

function beginSignedOutFlow({
  requestRemoteSignOut = false,
  sessionAlreadyCleared = false,
}: { requestRemoteSignOut?: boolean; sessionAlreadyCleared?: boolean } = {}): Promise<void> {
  if (signedOutHandled) return Promise.resolve();
  if (signedOutFlow) return signedOutFlow;
  authRoutingGeneration++;
  const flow = (async () => {
    signedInHandledIdentity = null;
    signedIn = false;
    if (requestRemoteSignOut) {
      try {
        await AuthService.signOut();
      } catch {
        // Local cleanup must still run so an old session never lingers when
        // the connection drops during logout.
      }
    }
    if (!sessionAlreadyCleared) await appState.clearSessionState();
    signedOutHandled = true;
    await navigator.root(specs.fork());
  })();
  signedOutFlow = flow;
  return flow.finally(() => {
    signedOutFlow = null;
  });
}

function routeAfterLoginNow() {
  const deepLink = pendingDeepLink;
  pendingDeepLink = null;
  const intent = appState.consumePendingMerchantIntent();
  if (deepLink) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(deepLink, "https://savebite.invalid");
    } catch {
      parsed = null;
    }
    const match = parsed ? matchRoute(parsed.pathname) : null;
    if (parsed && match && !ENTRY_PATHS.has(parsed.pathname) && routeSpace(match) !== "public") {
      const space = routeSpace(match);
      const wantMerchant = space === "merchant" || (space === "shared" && (intent ?? appState.lastMode === "merchant"));
      if (wantMerchant) {
        appState.switchToMerchant();
        appState.rememberMode("merchant");
        if (!appState.merchantSetupDone) {
          void navigator.root(specs.storeSetup());
          return;
        }
      } else {
        appState.switchToConsumer();
        appState.rememberMode("consumer");
        if (!appState.locationPrimed) {
          void navigator.root(specs.locationPriming());
          return;
        }
      }
      const stack = stackFor(match, parsed.searchParams);
      void navigator.reset(stack);
      return;
    }
  }
  // An explicit choice on the fork (true/false) wins; otherwise lastMode.
  const wantMerchant = intent ?? appState.lastMode === "merchant";
  if (wantMerchant) {
    appState.switchToMerchant();
    appState.rememberMode("merchant");
    void navigator.root(appState.merchantSetupDone ? specs.merchantShell() : specs.storeSetup());
  } else {
    appState.switchToConsumer();
    appState.rememberMode("consumer");
    void navigator.root(appState.locationPrimed ? specs.consumerShell() : specs.locationPriming());
  }
}

// ── AppNav ────────────────────────────────────────────────────────────────

export const AppNav = {
  // Onboarding & akun
  toOnboarding: () => void navigator.replace(specs.onboarding()),
  toFork: () => void navigator.push(specs.fork()),
  toForkRoot: () => void navigator.root(specs.fork()),
  toLogin: ({ merchant, next }: { merchant: boolean; next?: string }) => void navigator.push(specs.login(merchant, next)),

  /** Remembers the URL the app was opened on, to honour it after sign-in. */
  setPendingDeepLink(url: string | null) {
    pendingDeepLink = url;
  },

  /** Local login exists only in the explicit demo build. */
  async completeLogin({ merchant }: { merchant: boolean }) {
    if (!AuthService.isConfigured && !AuthService.isDemoMode) {
      throw new BackendException("missing_client_configuration", "Konfigurasi Supabase belum tersedia pada build ini.");
    }
    await appState.setPendingMerchantIntent(merchant);
    await AppNav.handleSignedIn();
  },

  /**
   * After a session is active: load profile/store, then route to the right
   * workspace. `initialSession`, `signedIn` and the startup fallback can
   * arrive close together; one shared promise runs bootstrap and root
   * navigation once per session identity.
   */
  handleSignedIn(): Promise<void> {
    if (signedInFlow && signedInFlowGeneration === authRoutingGeneration) return signedInFlow;
    const routingGeneration = authRoutingGeneration;
    const flow = (async () => {
      const identity = await currentIdentity();
      if (signedInHandledIdentity === identity) return;
      if (AuthService.isConfigured) {
        try {
          const session = await AuthService.restoreValidSession();
          if (!session) {
            await beginSignedOutFlow();
            return;
          }
        } catch (error) {
          if (!(await AuthService.currentSession())) {
            await beginSignedOutFlow();
            return;
          }
          appState.reportError(error);
          throw error;
        }
      }
      if (routingGeneration !== authRoutingGeneration) return;
      // A new session may run a new logout cycle; the flag only blocks
      // duplicate signedOut events within one session.
      signedOutHandled = false;
      await appState.bootstrap();
      if (routingGeneration !== authRoutingGeneration) return;
      signedIn = true;
      routeAfterLoginNow();
      signedInHandledIdentity = identity;
    })();
    signedInFlow = flow;
    signedInFlowGeneration = routingGeneration;
    return flow.then(
      () => {
        if (signedInFlow === flow) {
          signedInFlow = null;
          signedInFlowGeneration = null;
        }
      },
      () => {
        if (signedInFlow === flow) {
          signedInFlow = null;
          signedInFlowGeneration = null;
        }
        void navigator.root(
          specs.startupError(appState.errorMessage ?? "Data akun belum dapat dimuat. Periksa koneksi lalu coba lagi."),
        );
      },
    );
  },

  /**
   * Startup root without a session. Different from a logout event: a new
   * user still completes onboarding once. Public deep links (login, legal)
   * open directly; a protected one asks to sign in for its workspace.
   */
  routeLoggedOutAtStartup(url: string) {
    authRoutingGeneration++;
    signedInHandledIdentity = null;
    signedIn = false;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url, "https://savebite.invalid");
    } catch {
      parsed = null;
    }
    const match = parsed ? matchRoute(parsed.pathname) : null;
    if (parsed && match && parsed.pathname !== "/") {
      const space = routeSpace(match);
      if (space === "public") {
        void navigator.reset(stackFor(match, parsed.searchParams));
        return;
      }
      if (match.name !== "consumerTab" || match.tab !== 0) {
        const next = `${parsed.pathname}${parsed.search}`;
        void navigator.reset([specs.fork(), specs.login(space === "merchant", next)]);
        return;
      }
    }
    void navigator.root(appState.onboardingSeen ? specs.fork() : specs.onboarding());
  },

  routeAfterLogin: () => routeAfterLoginNow(),

  logout: () => beginSignedOutFlow({ requestRemoteSignOut: true }),

  /** Handles the global signedOut auth event; shares the logout flow. */
  handleSignedOut: () => beginSignedOutFlow(),

  async switchToMerchant() {
    appState.switchToMerchant();
    appState.rememberMode("merchant");
    appState.clearError();
    await appState.loadStore();
    const error = appState.storeError;
    if (error) {
      appState.switchToConsumer();
      appState.rememberMode("consumer");
      throw new BackendException("store_load_failed", error);
    }
    if (appState.merchantSetupDone) AppNav.toMerchantHome();
    else void navigator.root(specs.storeSetup());
  },

  switchToConsumer() {
    appState.switchToConsumer();
    appState.rememberMode("consumer");
    if (appState.locationPrimed) AppNav.toConsumerHome();
    else void navigator.root(specs.locationPriming());
  },

  async deleteAccount() {
    await appState.deleteAccount();
    await beginSignedOutFlow({ requestRemoteSignOut: true, sessionAlreadyCleared: true });
  },

  // Root ekosistem
  toConsumerHome: () => void navigator.root(specs.consumerShell()),
  toMerchantHome: () => void navigator.root(specs.merchantShell()),
  toMerchantOrders: ({
    initialTab = "active",
    referencedOrderId = null,
  }: { initialTab?: MerchantOrdersTab; referencedOrderId?: string | null } = {}) =>
    void navigator.root(specs.merchantShell({ initialIndex: 2, initialOrdersTab: initialTab, referencedOrderId })),
  toMerchantBalance: () => void navigator.root(specs.merchantShell({ initialIndex: 3 })),
  toStoreSetup: () => void navigator.push(specs.storeSetup()),
  toLocationPriming: () => void navigator.root(specs.locationPriming()),
  toOrders: ({
    initialTab = "active",
    referencedOrderId = null,
  }: { initialTab?: ConsumerOrdersTab; referencedOrderId?: string | null } = {}) =>
    void navigator.root(specs.consumerShell({ initialIndex: 2, initialOrdersTab: initialTab, referencedOrderId })),

  // Konsumen
  toDetail: (bag: Bag) => void navigator.push(specs.detail(bag)),
  toSearch: () => void navigator.push(specs.search()),

  /** Opens the filter sheet; resolves the chosen filter, or undefined. */
  showFilter: () =>
    showSheet<BagFilter>((close) => <FilterSheet close={close} />, { barrierColor: SHEET_BARRIER, label: "Filter" }),

  toCheckout: (bag: Bag) => void navigator.push(specs.checkout(bag)),

  toProcessing({
    bag,
    qty,
    method,
    idempotencyKey = null,
    replace = false,
  }: {
    bag: Bag;
    qty: number;
    method: string;
    idempotencyKey?: string | null;
    replace?: boolean;
  }) {
    const spec = specs.processing({ bag, qty, method, idempotencyKey });
    if (replace) void navigator.replace(spec);
    else void navigator.push(spec);
  },

  toResumePayment: (order: OrderRecord) =>
    void navigator.push(
      specs.processing({ bag: order.bag, qty: order.quantity, method: order.paymentMethod, existingOrder: order }),
    ),

  toVoucher(order: OrderRecord, { replace = false, completeCheckout = false }: { replace?: boolean; completeCheckout?: boolean } = {}) {
    const spec = specs.voucher(order);
    if (completeCheckout) {
      // Remove the checkout route and everything above it, then show the
      // voucher where checkout was (removeRoute + pushReplacement).
      const checkoutIndex = navigator.indexOfName(CHECKOUT_ROUTE);
      if (checkoutIndex > 0) void navigator.popUntilAndPush(checkoutIndex - 1, spec);
      else void navigator.replace(spec);
      return;
    }
    if (replace) void navigator.replace(spec);
    else void navigator.push(spec);
  },

  toPaymentFailed: (input: { bag: Bag; method: string; qty?: number; idempotencyKey?: string | null; message?: string | null }) =>
    void navigator.replace(specs.paymentFailed(input)),

  toStoreProfile: (merchant: Merchant) => void navigator.push(specs.storeProfile(merchant)),
  toRating: (order: OrderRecord) => navigator.push<boolean>(specs.rating(order)),
  toNotifications: () => void navigator.push(specs.notifications()),
  toEditProfile: () => navigator.push<boolean>(specs.editProfile()),
  toHelp: () => void navigator.push(specs.help()),
  toLegal: (document: LegalDocument) => void navigator.push(specs.legal(document)),

  openNotification(notification: AppNotification) {
    const route = (notification.route ?? "").trim();
    const normalized = route.toLowerCase();
    const consumerTarget = parseConsumerOrderNotificationRoute(route);
    const merchantTarget = parseMerchantOrderNotificationRoute(route);
    if (normalized === "merchant_orders" || merchantTarget) {
      appState.switchToMerchant();
      appState.rememberMode("merchant");
      AppNav.toMerchantOrders({
        initialTab: merchantTarget?.preferredTab ?? "active",
        referencedOrderId: merchantTarget?.orderId ?? null,
      });
    } else if (normalized === "merchant_balance") {
      appState.switchToMerchant();
      appState.rememberMode("merchant");
      AppNav.toMerchantBalance();
    } else if (normalized === "merchant_reviews") {
      appState.switchToMerchant();
      appState.rememberMode("merchant");
      AppNav.toMerchantReviews({ root: true });
    } else if (normalized === "orders" || consumerTarget) {
      appState.switchToConsumer();
      appState.rememberMode("consumer");
      AppNav.toOrders({
        initialTab:
          consumerTarget?.preferredTab ?? (normalized === "orders" && notification.type === "rating" ? "history" : "active"),
        referencedOrderId: consumerTarget?.orderId ?? null,
      });
    } else if (normalized === "consumer_home" || normalized === "home") {
      appState.switchToConsumer();
      appState.rememberMode("consumer");
      AppNav.toConsumerHome();
    }
  },

  // Merchant
  toCreateBag: () => void navigator.push(specs.createBag()),
  toEditBag: (bag: MerchantBag) => void navigator.push(specs.editBag(bag)),
  toOrderDetail: (order: IncomingOrder) => void navigator.push(specs.orderDetail(order)),
  toEditStore: () => void navigator.push(specs.editStore()),
  toMerchantReviews({ root = false }: { root?: boolean } = {}) {
    const spec = specs.merchantReviews(root);
    if (!root) {
      void navigator.push(spec);
      return;
    }
    // Flutter roots the reviews screen and its PopScope sends back to the
    // merchant home. Putting home beneath gives the browser back button the
    // same destination.
    void navigator.root(specs.merchantShell());
    void navigator.push(spec);
  },

  /**
   * Opens the pickup scanner. The token always comes from the camera and is
   * never supplied from a code shown on the merchant's screen.
   */
  toScanQr: () => navigator.push<boolean>(specs.scanQr()),

  /** Opens the withdraw sheet; resolves the withdrawn amount, or undefined. */
  showWithdraw: () =>
    showSheet<number>((close) => <WithdrawSheet close={close} />, { barrierColor: SHEET_BARRIER, label: "Tarik saldo" }),

  toWithdrawSuccess: (request: PayoutRequest) => void navigator.push(specs.withdrawSuccess(request)),

  /** `Navigator.maybePop(result)`. */
  back: (result?: unknown) => navigator.maybePop(result),

  /** `Navigator.pop(result)` (ignores PopScope guards). */
  pop: (result?: unknown) => navigator.pop(result),

  /** Test seam. */
  resetAuthRoutingForTest() {
    signedInFlow = null;
    signedInFlowGeneration = null;
    signedInHandledIdentity = null;
    signedOutFlow = null;
    signedOutHandled = false;
    authRoutingGeneration = 0;
    pendingDeepLink = null;
    signedIn = false;
  },
};
