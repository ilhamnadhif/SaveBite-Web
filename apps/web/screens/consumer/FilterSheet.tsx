"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { appState } from "../../lib/appState";
import { bagMatchesFilter, type BagFilter, type TimeOfDay } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { Gap, SheetHandle, Spacer, Switch, Wrap } from "../../ui/common";
import { C, R, argb, display, ui } from "../../ui/theme";

const ALL_CATEGORIES = ["Bakery", "Kafe", "Resto", "Supermarket", "Sehat"] as const;
const PRICE_LABELS = ["Semua harga", "< Rp15rb", "Rp15–30rb", "> Rp30rb"] as const;
const PICKUP_LABELS = ["Kapan saja", "Pagi", "Siang", "Sore", "Malam"] as const;

function priceIndex(filter: BagFilter): number {
  if (filter.minPrice === null && filter.maxPrice === null) return 0;
  if (filter.minPrice === null && (filter.maxPrice ?? 0) < 15000) return 1;
  if ((filter.minPrice ?? 0) >= 15000 && (filter.maxPrice ?? 30000) <= 30000) {
    return 2;
  }
  if ((filter.minPrice ?? 0) > 30000 && filter.maxPrice === null) return 3;
  return 0;
}

function pickupIndex(filter: BagFilter): number {
  const start = filter.pickupAfter;
  if (start === null && filter.pickupBefore === null) return 0;
  const minutes = start === null ? -1 : start.hour * 60 + start.minute;
  if (minutes < 12 * 60) return 1;
  if (minutes < 17 * 60) return 2;
  if (minutes < 19 * 60) return 3;
  return 4;
}

function buildFilter({
  categories,
  limitDistance,
  distance,
  price,
  pickup,
}: {
  categories: ReadonlySet<string>;
  limitDistance: boolean;
  distance: number;
  price: number;
  pickup: number;
}): BagFilter {
  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  switch (price) {
    case 1:
      maxPrice = 14999;
      break;
    case 2:
      minPrice = 15000;
      maxPrice = 30000;
      break;
    case 3:
      minPrice = 30001;
      break;
    default:
      break;
  }

  let pickupAfter: TimeOfDay | null = null;
  let pickupBefore: TimeOfDay | null = null;
  switch (pickup) {
    case 1:
      pickupAfter = { hour: 5, minute: 0 };
      pickupBefore = { hour: 11, minute: 59 };
      break;
    case 2:
      pickupAfter = { hour: 12, minute: 0 };
      pickupBefore = { hour: 16, minute: 59 };
      break;
    case 3:
      pickupAfter = { hour: 17, minute: 0 };
      pickupBefore = { hour: 18, minute: 59 };
      break;
    case 4:
      pickupAfter = { hour: 19, minute: 0 };
      pickupBefore = { hour: 23, minute: 59 };
      break;
    default:
      break;
  }

  return {
    categories: new Set(categories),
    maxDistanceKm: limitDistance ? distance : null,
    minPrice,
    maxPrice,
    pickupAfter,
    pickupBefore,
  };
}

/**
 * Discovery filter that produces one structured {@link BagFilter}. Opened by
 * `AppNav.showFilter()`; `close(filter)` is `Navigator.pop(_filter)`.
 */
export function FilterSheet({ close }: { close: (filter?: BagFilter) => void }) {
  const state = useAppState();
  const [categories, setCategories] = useState<ReadonlySet<string>>(() => new Set(appState.currentFilter.categories));
  const [limitDistance, setLimitDistance] = useState(() => appState.currentFilter.maxDistanceKm !== null);
  const [distance, setDistance] = useState(() => Math.min(20, Math.max(0.5, appState.currentFilter.maxDistanceKm ?? 5)));
  const [price, setPrice] = useState(() => priceIndex(appState.currentFilter));
  const [pickup, setPickup] = useState(() => pickupIndex(appState.currentFilter));

  const filter = buildFilter({ categories, limitDistance, distance, price, pickup });
  const count = state.allNearbyBags.filter((bag) => bagMatchesFilter(bag, filter)).length;

  const toggleCategory = (category: string) => {
    setCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const reset = () => {
    setCategories(new Set());
    setLimitDistance(false);
    setDistance(5);
    setPrice(0);
    setPickup(0);
  };

  return (
    // SafeArea(top: false) around the sheet.
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: "var(--safe-bottom)" }}>
      <div
        style={{
          // The scroll area is Expanded, so the sheet always takes 90% of the screen.
          height: "90dvh",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: C.cream,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
          overflow: "hidden",
        }}
      >
        <div className="sb-scroll" style={{ padding: "14px 24px 12px" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <SheetHandle />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <h2 style={display(22, { weight: 800 })}>Filter</h2>
            <Spacer />
            <TextButton
              label={<span style={ui(14, { weight: 700, color: C.greenBright })}>Reset</span>}
              color={C.greenBright}
              onTap={reset}
            />
          </div>
          <Gap h={16} />
          <SectionLabel text="Kategori" />
          <Wrap spacing={9} runSpacing={9}>
            {ALL_CATEGORIES.map((category) => (
              <SelectChip
                key={category}
                label={category}
                selected={categories.has(category)}
                padding="9px 15px"
                onTap={() => toggleCategory(category)}
              />
            ))}
          </Wrap>
          <Gap h={24} />
          {/* SwitchListTile: the whole row toggles the switch. */}
          <label
            style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 72, padding: "8px 0", cursor: "pointer" }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", ...ui(14, { weight: 700 }) }}>Batasi jarak</span>
              <span style={{ display: "block", ...ui(12, { color: C.body }) }}>Hanya tampilkan toko dalam radius pilihan</span>
            </span>
            <Switch value={limitDistance} onChange={setLimitDistance} activeColor={C.greenBright} label="Batasi jarak" />
          </label>
          {limitDistance ? (
            <>
              <Gap h={2} />
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={ui(13, { weight: 600 })}>Jarak maksimal</span>
                <Spacer />
                <span style={ui(14, { weight: 700, color: C.greenBright })}>
                  {distance < 1
                    ? `${Math.round(distance * 1000)} m`
                    : `${distance.toFixed(distance % 1 === 0 ? 0 : 1)} km`}
                </span>
              </div>
              <DistanceSlider value={distance} onChange={setDistance} />
            </>
          ) : null}
          <Gap h={20} />
          <SectionLabel text="Rentang harga" />
          <Wrap spacing={9} runSpacing={9}>
            {PRICE_LABELS.map((label, index) => (
              <SelectChip
                key={label}
                label={label}
                selected={price === index}
                padding="9px 14px"
                onTap={() => setPrice(index)}
              />
            ))}
          </Wrap>
          <Gap h={24} />
          <SectionLabel text="Jam pickup dimulai" />
          <Wrap spacing={9} runSpacing={9}>
            {PICKUP_LABELS.map((label, index) => (
              <SelectChip
                key={label}
                label={label}
                selected={pickup === index}
                padding="9px 14px"
                onTap={() => setPickup(index)}
              />
            ))}
          </Wrap>
        </div>
        <div style={{ flex: "none", padding: "12px 24px 16px", background: C.cream, borderTop: `1px solid ${C.divider}` }}>
          <PrimaryButton label={`Terapkan · ${count} hasil`} onTap={() => close(filter)} />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <div style={{ paddingBottom: 11, ...ui(14, { weight: 700 }) }}>{text}</div>;
}

/* ------------------------------------------------------------------------- *
 * Distance slider: Material 3 `Slider(min: 0.5, max: 20, divisions: 39)`
 * under the sheet's `SliderTheme` (track 6, active greenBright, inactive
 * chipBorder, white thumb r9, overlay 0x2227A36A). Geometry follows Flutter:
 * a 48px-tall box, the track inset by the 24px overlay radius, the active
 * track 2px taller, tick marks only when there is room for them, and the
 * value indicator shown while the thumb is dragged.
 * ------------------------------------------------------------------------- */

const DISTANCE_MIN = 0.5;
const DISTANCE_MAX = 20;
const DISTANCE_DIVISIONS = 39;
const SLIDER_HEIGHT = 48;
const OVERLAY_RADIUS = 24;
const THUMB_RADIUS = 9;
const TRACK_HEIGHT = 6;
const ACTIVE_TRACK_HEIGHT = TRACK_HEIGHT + 2;
const TICK_RADIUS = TRACK_HEIGHT / 4;
const OVERLAY_COLOR = argb(0x2227a36a);
/** M3 defaults: onPrimary / onSurfaceVariant at 38%. */
const ACTIVE_TICK_COLOR = "rgba(255, 255, 255, 0.38)";
const INACTIVE_TICK_COLOR = "rgba(64, 73, 67, 0.38)";

/** Slider `_lerp` / `_unlerp` / `_discretize` on the normalised 0..1 value. */
const lerp = (t: number) => t * (DISTANCE_MAX - DISTANCE_MIN) + DISTANCE_MIN;
const unlerp = (value: number) => (value - DISTANCE_MIN) / (DISTANCE_MAX - DISTANCE_MIN);
const discretize = (t: number) => Math.round(Math.min(1, Math.max(0, t)) * DISTANCE_DIVISIONS) / DISTANCE_DIVISIONS;

/** CSS position along the track for a normalised value. */
const trackPosition = (t: number, offset = 0) =>
  `calc(${OVERLAY_RADIUS + offset}px + (100% - ${2 * OVERLAY_RADIUS}px) * ${t})`;

function DistanceSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const draggingRef = useRef(false);
  // Last value handed to onChange, so fast pointer moves compare against it.
  const lastValue = useRef(value);
  lastValue.current = value;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown = discretize(unlerp(value));
  const trackWidth = Math.max(0, width - 2 * OVERLAY_RADIUS);
  const thumbX = OVERLAY_RADIUS + shown * trackWidth;
  // Tick marks are skipped when they would be too dense (Flutter's rule).
  const adjustedTrackWidth = trackWidth - TRACK_HEIGHT;
  const showTicks = width > 0 && adjustedTrackWidth / DISTANCE_DIVISIONS >= 3 * (2 * TICK_RADIUS);

  const emit = (next: number) => {
    if (next === lastValue.current) return;
    lastValue.current = next;
    onChange(next);
  };

  const valueAt = (clientX: number) => {
    const element = ref.current;
    if (!element) return lastValue.current;
    const rect = element.getBoundingClientRect();
    const track = rect.width - 2 * OVERLAY_RADIUS;
    const t = track > 0 ? (clientX - rect.left - OVERLAY_RADIUS) / track : 0;
    return lerp(discretize(t));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The drag still works without capture while the pointer stays inside.
    }
    draggingRef.current = true;
    setDragging(true);
    emit(valueAt(event.clientX));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    emit(valueAt(event.clientX));
  };

  const endDrag = () => {
    draggingRef.current = false;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const unit = 1 / DISTANCE_DIVISIONS;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(1, shown + unit);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(0, shown - unit);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    emit(lerp(next));
  };

  const overlayVisible = dragging || hovered || focused;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Jarak maksimal dalam kilometer"
      aria-valuemin={DISTANCE_MIN}
      aria-valuemax={DISTANCE_MAX}
      aria-valuenow={value}
      aria-valuetext={value.toFixed(1)}
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onPointerEnter={(event) => setHovered(event.pointerType === "mouse")}
      onPointerLeave={() => setHovered(false)}
      onKeyDown={onKeyDown}
      onFocus={(event) => setFocused(focusVisible(event.currentTarget))}
      onBlur={() => setFocused(false)}
      style={{
        position: "relative",
        height: SLIDER_HEIGHT,
        cursor: "pointer",
        outline: "none",
        touchAction: "pan-y",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Inactive track (right of the thumb). */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: trackPosition(shown),
          right: OVERLAY_RADIUS,
          top: (SLIDER_HEIGHT - TRACK_HEIGHT) / 2,
          height: TRACK_HEIGHT,
          background: C.chipBorder,
          borderTopRightRadius: TRACK_HEIGHT / 2,
          borderBottomRightRadius: TRACK_HEIGHT / 2,
        }}
      />
      {/* Active track (left of the thumb), 2px taller. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: OVERLAY_RADIUS,
          width: `calc((100% - ${2 * OVERLAY_RADIUS}px) * ${shown})`,
          top: (SLIDER_HEIGHT - ACTIVE_TRACK_HEIGHT) / 2,
          height: ACTIVE_TRACK_HEIGHT,
          background: C.greenBright,
          borderTopLeftRadius: ACTIVE_TRACK_HEIGHT / 2,
          borderBottomLeftRadius: ACTIVE_TRACK_HEIGHT / 2,
        }}
      />
      {showTicks
        ? Array.from({ length: DISTANCE_DIVISIONS + 1 }, (_, index) => {
            const x = OVERLAY_RADIUS + (index / DISTANCE_DIVISIONS) * adjustedTrackWidth + TRACK_HEIGHT / 2;
            return (
              <span
                key={index}
                aria-hidden
                style={{
                  position: "absolute",
                  left: x - TICK_RADIUS,
                  top: SLIDER_HEIGHT / 2 - TICK_RADIUS,
                  width: TICK_RADIUS * 2,
                  height: TICK_RADIUS * 2,
                  borderRadius: "50%",
                  background: x > thumbX ? INACTIVE_TICK_COLOR : ACTIVE_TICK_COLOR,
                }}
              />
            );
          })
        : null}
      {overlayVisible ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: trackPosition(shown, -OVERLAY_RADIUS),
            top: SLIDER_HEIGHT / 2 - OVERLAY_RADIUS,
            width: OVERLAY_RADIUS * 2,
            height: OVERLAY_RADIUS * 2,
            borderRadius: "50%",
            background: OVERLAY_COLOR,
          }}
        />
      ) : null}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: trackPosition(shown, -THUMB_RADIUS),
          top: SLIDER_HEIGHT / 2 - THUMB_RADIUS,
          width: THUMB_RADIUS * 2,
          height: THUMB_RADIUS * 2,
          borderRadius: "50%",
          background: C.white,
          boxShadow: dragging ? "0 3px 6px rgba(0, 0, 0, 0.28)" : "0 1px 2px rgba(0, 0, 0, 0.3)",
        }}
      />
      {dragging ? <ValueIndicator left={trackPosition(shown)} label={`${value.toFixed(1)} km`} /> : null}
    </div>
  );
}

/** M3 `DropSliderValueIndicatorShape`: a 28px bubble whose tip sits 16px above the thumb centre. */
function ValueIndicator({ left, label }: { left: string; label: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left,
        bottom: SLIDER_HEIGHT / 2 + 16,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <span
        style={{
          minWidth: 36,
          height: 28,
          padding: "0 8px",
          borderRadius: 4,
          background: C.green,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "nowrap",
          ...ui(12, { weight: 500, color: C.white, letterSpacing: 0.5 }),
        }}
      >
        {label}
      </span>
      <span
        style={{
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: `6px solid ${C.green}`,
        }}
      />
    </span>
  );
}

/** Keyboard focus only: Flutter's slider does not take focus when tapped. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}
