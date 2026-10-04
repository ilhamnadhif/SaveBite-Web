"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { formatRupiah, isFilterEmpty, type Bag } from "../../lib/models";
import { FoodImage, PriceTag } from "../../ui/bagCards";
import { IconButton, PrimaryButton, TextButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { AppCard, CountBadge, EmptyState, Gap, InfoBanner, Scroll, Screen, Spinner, Wrap, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, R, display, ellipsis, ui } from "../../ui/theme";

const POPULAR = ["Roti", "Kopi", "Donat", "Pastry", "Bakery"] as const;

/**
 * Store and Surprise Bag search with a debounce and a stale-result guard.
 *
 * Like the Flutter screen it reads `appState.currentFilter` without listening
 * to it, and rebuilds itself after changing the filter.
 */
export function SearchScreen() {
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<readonly Bag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setRebuild] = useState(0);
  // `_query` and `_searchSequence` are read after awaits and from the timer.
  const queryRef = useRef("");
  const searchSequence = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (debounce.current !== null) clearTimeout(debounce.current);
    };
  }, []);

  const cancelDebounce = () => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
  };

  const runSearch = async (value: string) => {
    const trimmed = value.trim();
    const sequence = ++searchSequence.current;
    if (!trimmed) return;
    if (mounted.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const found = await appState.search(trimmed);
      if (!mounted.current || sequence !== searchSequence.current) return;
      setLoading(false);
      setResults(found.filter((bag) => !bag.soldOut));
    } catch {
      if (!mounted.current || sequence !== searchSequence.current) return;
      setLoading(false);
      setResults([]);
      setError("Pencarian gagal dimuat. Periksa koneksimu lalu coba lagi.");
    }
  };

  const setQuery = (value: string) => {
    cancelDebounce();
    queryRef.current = value;
    setQueryState(value);
    setError(null);
    if (!value.trim()) {
      setResults([]);
      setLoading(false);
      searchSequence.current++;
      return;
    }
    debounce.current = setTimeout(() => void runSearch(value), 350);
  };

  const submit = async (value: string) => {
    cancelDebounce();
    await runSearch(value);
  };

  const pickPopular = (term: string) => {
    // Setting the controller text does not fire onChanged.
    queryRef.current = term;
    setQueryState(term);
    void submit(term);
  };

  const showFilter = async () => {
    const filter = await AppNav.showFilter();
    if (!mounted.current || !filter) return;
    await appState.setBagFilter(filter);
    if (!mounted.current) return;
    setRebuild((value) => value + 1);
    if (queryRef.current.trim()) await submit(queryRef.current);
  };

  const unfocus = () => inputRef.current?.blur();

  // GestureDetector(onTap: _focusNode.unfocus) around the screen: a tap that
  // no button claims closes the keyboard.
  const onBackgroundTap = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("input, button, a, [role='button']")) return;
    unfocus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    // TextInputAction.search closes the keyboard on submit.
    const value = event.currentTarget.value;
    unfocus();
    void submit(value);
  };

  const filterActive = !isFilterEmpty(appState.currentFilter);
  const hasQuery = query.trim() !== "";
  const trimmedQuery = query.trim();

  const emptyQueryView = () => (
    <Scroll style={{ padding: "22px 20px 24px" }}>
      <div style={ui(12.5, { weight: 700, color: C.body })}>Pencarian populer</div>
      <Gap h={14} />
      <Wrap spacing={10} runSpacing={10}>
        {POPULAR.map((term) => (
          <SelectChip key={term} label={term} onTap={() => pickPopular(term)} />
        ))}
      </Wrap>
      {filterActive ? (
        <>
          <Gap h={28} />
          <InfoBanner icon="filter_alt_outlined">
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ flex: 1, minWidth: 0, ...ui(12.5, { color: C.body }) }}>
                Filter discovery juga berlaku pada hasil pencarian.
              </span>
              <TextButton label="Ubah" onTap={() => void showFilter()} />
            </div>
          </InfoBanner>
        </>
      ) : null}
    </Scroll>
  );

  const resultsView = () => {
    if (loading) {
      return (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Mencari ${query}`}
          style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <Spinner size={26} strokeWidth={2.4} color={C.greenBright} />
        </div>
      );
    }
    if (error !== null) {
      return (
        <CenteredFill>
          <EmptyState
            icon="cloud_off_outlined"
            title="Pencarian gagal"
            message={error}
            action={
              <ActionBox width={210}>
                <PrimaryButton label="Coba lagi" height={50} onTap={() => void submit(query)} />
              </ActionBox>
            }
          />
        </CenteredFill>
      );
    }
    if (results.length === 0) {
      return (
        <CenteredFill>
          <EmptyState
            icon="search_off"
            title="Tak ada hasil"
            message={
              filterActive
                ? `Tak ada hasil untuk “${trimmedQuery}” dengan filter saat ini.`
                : `Tak ada toko atau bag yang cocok dengan “${trimmedQuery}”.`
            }
            action={
              filterActive ? (
                <ActionBox width={210}>
                  <PrimaryButton label="Ubah filter" height={50} onTap={() => void showFilter()} />
                </ActionBox>
              ) : undefined
            }
          />
        </CenteredFill>
      );
    }
    return (
      // keyboardDismissBehavior: onDrag.
      <Scroll onTouchMove={unfocus} style={{ padding: "18px 20px 24px" }}>
        <div className="sb-sr-only" role="status" aria-live="polite">
          {`${results.length} hasil ditemukan`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={ui(12.5, { weight: 700, color: C.body })}>{`${results.length} hasil untuk “${trimmedQuery}”`}</div>
          {results.map((bag) => (
            <ResultCard key={bag.id} bag={bag} />
          ))}
        </div>
      </Scroll>
    );
  };

  return (
    <Screen background={C.cream} onClick={onBackgroundTap}>
      <div
        style={{
          flex: "none",
          background: C.white,
          paddingTop: safeTop(10),
          paddingRight: 12,
          paddingBottom: 12,
          paddingLeft: 8,
          display: "flex",
          alignItems: "center",
        }}
      >
        <IconButton
          tooltip="Kembali"
          icon="arrow_back_ios_new"
          size={18}
          color={C.ink}
          onTap={() => void AppNav.back()}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: C.cream,
              borderRadius: R.input,
              border: `1.5px solid ${C.inputBorder}`,
              padding: "0 12px",
            }}
          >
            <Icon name="search" size={20} color={C.muted} />
            <Gap w={8} />
            <input
              ref={inputRef}
              type="text"
              className="sb-input"
              aria-label="Cari toko atau makanan…"
              placeholder="Cari toko atau makanan…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              // Flutter `autofocus: true`.
              autoFocus
              style={{ flex: 1, minWidth: 0, ...ui(14.5, { color: C.ink }), caretColor: C.greenBright }}
            />
            {query !== "" ? (
              <IconButton
                tooltip="Hapus pencarian"
                icon={<Icon name="close" size={19} color={C.muted} />}
                onTap={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                style={{ width: 38, height: 38 }}
              />
            ) : null}
          </div>
        </div>
        <Gap w={4} />
        <IconButton
          tooltip="Filter pencarian"
          onTap={() => void showFilter()}
          icon={
            <span style={{ position: "relative", display: "flex" }}>
              <Icon name="tune" color={C.green} />
              {filterActive ? <CountBadge /> : null}
            </span>
          }
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {hasQuery ? resultsView() : emptyQueryView()}
      </div>
    </Screen>
  );
}

function ResultCard({ bag }: { bag: Bag }) {
  return (
    <AppCard
      padding={0}
      onTap={() => AppNav.toDetail(bag)}
      ariaLabel={`${bag.title}, ${bag.merchant.name}, ${formatRupiah(bag.salePrice)}`}
    >
      <span style={{ display: "flex", alignItems: "stretch" }}>
        <span
          style={{
            position: "relative",
            display: "block",
            width: 86,
            minHeight: 94,
            flex: "none",
            overflow: "hidden",
            borderTopLeftRadius: R.cardSm,
            borderBottomLeftRadius: R.cardSm,
          }}
        >
          <FoodImage path={bag.image} style={{ position: "absolute", inset: 0 }} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            padding: "11px 12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <span style={{ display: "block", ...display(15, { weight: 700, letterSpacing: -0.2 }), ...ellipsis }}>
            {bag.title}
          </span>
          <span style={{ display: "block", marginTop: 3, ...ui(12.5, { color: C.body }), ...ellipsis }}>
            {`${bag.merchant.name} · ${bag.merchant.distance}`}
          </span>
          <span style={{ display: "block", marginTop: 7 }}>
            <PriceTag salePrice={bag.salePrice} originalPrice={bag.originalPrice} saleSize={16} />
          </span>
        </span>
      </span>
    </AppCard>
  );
}

/** `SizedBox(width:)` around an empty-state button; shrinks on narrow screens. */
function ActionBox({ width, children }: { width: number; children: ReactNode }) {
  return <div style={{ width, maxWidth: "100%" }}>{children}</div>;
}

/** An `EmptyState` placed directly in an `Expanded`: centred, scrolls if it cannot fit. */
function CenteredFill({ children }: { children: ReactNode }) {
  return (
    <div className="sb-scroll" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ margin: "auto 0" }}>{children}</div>
    </div>
  );
}
