"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import type { TimeOfDay } from "../../lib/models";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { FieldLabel, Gap, Screen, Scroll, SimpleHeader, Spinner, Wrap, safeBottom } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { pickTime } from "../../ui/pickers";
import { C, argb, ui } from "../../ui/theme";
import { MerchantFormField, formatMerchantTime, merchantTimeFromText, parseMerchantTimeMinutes } from "./MerchantFormFields";
import {
  StoreLocationInputException,
  StoreLocationSection,
  isValidStoreCoordinate,
  isValidStorePoint,
  type StoreCurrentLocation,
  type StoreGeoPoint,
} from "./StoreLocationSection";

const DEFAULT_CATEGORIES: readonly string[] = ["Bakery", "Kafe", "Resto", "Sehat", "Supermarket", "Lainnya"];

type FieldErrors = {
  name: string | null;
  address: string | null;
  open: string | null;
  close: string | null;
  description: string | null;
};

/** The form's starting values, read once like the Dart `late final` fields. */
function initialForm() {
  const categories =
    appState.storeCategory.trim() !== "" && !DEFAULT_CATEGORIES.includes(appState.storeCategory)
      ? [...DEFAULT_CATEGORIES, appState.storeCategory]
      : DEFAULT_CATEGORIES;
  return {
    categories,
    name: appState.storeName,
    address: appState.storeAddress,
    open: appState.openTime,
    close: appState.closeTime,
    description: appState.storeDescription,
    category: categories.includes(appState.storeCategory) ? appState.storeCategory : categories[0],
    logoUrl: appState.storeLogoUrl,
    latitude: appState.storeLatitude,
    longitude: appState.storeLongitude,
  };
}

/** Edit Toko: a full screen with a bottom bar. */
export function EditStoreScreen() {
  const [initial] = useState(initialForm);
  const categories = initial.categories;
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [open, setOpen] = useState(initial.open);
  const [close, setClose] = useState(initial.close);
  const [description, setDescription] = useState(initial.description);
  const [selectedCategory, setSelectedCategory] = useState(initial.category);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [coordinates, setCoordinates] = useState({ latitude: initial.latitude, longitude: initial.longitude });
  // Form(autovalidateMode: onUserInteraction): errors show once a field changed or validate() ran.
  const [autovalidate, setAutovalidate] = useState(false);
  const alive = useRef(true);
  const formId = useId();
  const nameId = `${formId}name`;
  const addressId = `${formId}address`;
  const openId = `${formId}open`;
  const closeId = `${formId}close`;
  const descriptionId = `${formId}description`;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fieldErrors = (): FieldErrors => ({
    name: validateStoreName(name),
    address: validateAddress(address),
    open: validateTime(open),
    close: validateClosingTime(close, open),
    description: description.trim().length > 500 ? "Maksimal 500 karakter" : null,
  });
  const errors = autovalidate ? fieldErrors() : null;

  const validate = () => {
    setAutovalidate(true);
    return Object.values(fieldErrors()).every((message) => message === null);
  };

  const pickFieldTime = async (value: string, setValue: (value: string) => void, fallback: TimeOfDay) => {
    unfocus();
    const selected = await pickTime({
      initial: merchantTimeFromText(value, fallback),
      helpText: "Pilih waktu operasional",
      cancelText: "Batal",
      confirmText: "Pilih",
    });
    if (!alive.current || selected === null) return;
    setValue(formatMerchantTime(selected));
    setAutovalidate(true);
  };

  const changePhoto = async () => {
    if (isSaving || isUploading) return;
    try {
      // First call of the tap: browsers only open the file chooser during the gesture.
      const upload = appState.uploadImage("logo");
      setIsUploading(true);
      const url = await upload;
      if (!alive.current || url === null) return;
      setLogoUrl(url);
      snack("Foto toko diperbarui");
    } catch {
      if (!alive.current) return;
      snack("Foto toko gagal diunggah. Coba lagi.", "error_outline");
    } finally {
      if (alive.current) setIsUploading(false);
    }
  };

  const save = async () => {
    if (isSaving || isUploading || isLocating) return;
    unfocus();
    if (!validate()) {
      snack("Periksa kembali data toko.", "error_outline");
      return;
    }
    const hasStoreLocation = isValidStoreCoordinate(coordinates.latitude, coordinates.longitude);
    if (!hasStoreLocation) {
      snack("Sinkronkan alamat dengan pin peta sebelum menyimpan.", "location_off_outlined");
      return;
    }

    setIsSaving(true);
    try {
      await appState.updateStore({
        name: name.trim(),
        category: selectedCategory,
        address: address.trim(),
        open: open.trim(),
        close: close.trim(),
        description: description.trim(),
        logoUrl,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      });
      if (!alive.current) return;
      snack("Profil toko diperbarui");
      void AppNav.back();
    } catch {
      if (!alive.current) return;
      snack("Profil toko gagal disimpan. Coba lagi.", "error_outline");
    } finally {
      if (alive.current) setIsSaving(false);
    }
  };

  const timeField = (
    id: string,
    value: string,
    setValue: (value: string) => void,
    fallback: TimeOfDay,
    error: string | null | undefined,
  ) => {
    const onTap = isSaving ? undefined : () => void pickFieldTime(value, setValue, fallback);
    return (
      <MerchantFormField
        id={id}
        value={value}
        readOnly
        error={error}
        onTap={onTap}
        trailing={<Icon name="schedule_outlined" size={18} color={C.muted} />}
        inputProps={{ onKeyDown: activateOnKey(onTap) }}
      />
    );
  };

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Edit Toko" />
      <Scroll style={{ padding: "18px 20px" }}>
        <LogoRow logoUrl={logoUrl} uploading={isUploading} onTap={isSaving || isUploading ? null : () => void changePhoto()} />
        <Gap h={20} />
        <FieldLabel htmlFor={nameId}>Nama toko</FieldLabel>
        <MerchantFormField
          id={nameId}
          value={name}
          onChange={(value) => {
            setName(value);
            setAutovalidate(true);
          }}
          error={errors?.name}
          autoCapitalize="words"
          enterKeyHint="next"
          inputProps={{ autoComplete: "off", onKeyDown: focusOnEnter(addressId) }}
        />
        <Gap h={16} />
        <FieldLabel>Kategori</FieldLabel>
        <div role="group" aria-label="Kategori">
          <Wrap spacing={8} runSpacing={8}>
            {categories.map((category) => (
              <SelectChip
                key={category}
                label={category}
                selected={selectedCategory === category}
                onTap={isSaving ? undefined : () => setSelectedCategory(category)}
              />
            ))}
          </Wrap>
        </div>
        <Gap h={16} />
        <StoreLocationSection
          inputId={addressId}
          address={address}
          onAddressChange={(value) => {
            setAddress(value);
            setAutovalidate(true);
          }}
          initialLatitude={coordinates.latitude}
          initialLongitude={coordinates.longitude}
          enabled={!isSaving && !isUploading}
          error={errors?.address}
          readCurrentLocation={readCurrentStoreLocation}
          onBusyChanged={(busy) => {
            if (alive.current) setIsLocating(busy);
          }}
          onPointChanged={(point) => {
            if (!alive.current) return;
            setCoordinates({ latitude: point?.latitude ?? null, longitude: point?.longitude ?? null });
          }}
        />
        <Gap h={16} />
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldLabel htmlFor={openId}>Jam buka</FieldLabel>
            {timeField(openId, open, setOpen, { hour: 8, minute: 0 }, errors?.open)}
          </div>
          <Gap w={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldLabel htmlFor={closeId}>Jam tutup</FieldLabel>
            {timeField(closeId, close, setClose, { hour: 21, minute: 0 }, errors?.close)}
          </div>
        </div>
        <Gap h={16} />
        <FieldLabel htmlFor={descriptionId}>Deskripsi</FieldLabel>
        <MerchantFormField
          id={descriptionId}
          value={description}
          onChange={(value) => {
            setDescription(value);
            setAutovalidate(true);
          }}
          error={errors?.description}
          hintText="Ceritakan tentang toko dan produkmu"
          maxLines={3}
          autoCapitalize="sentences"
          inputProps={{ autoComplete: "off" }}
        />
      </Scroll>
      <div
        style={{
          width: "100%",
          flex: "none",
          background: C.white,
          borderTop: `1px solid ${C.border}`,
          paddingTop: 14,
          paddingRight: 20,
          paddingBottom: safeBottom(30),
          paddingLeft: 20,
        }}
      >
        <PrimaryButton
          merchant
          label={isSaving ? "Menyimpan..." : "Simpan perubahan"}
          onTap={isSaving || isUploading || isLocating ? null : () => void save()}
        />
      </div>
    </Screen>
  );
}

function LogoRow({ logoUrl, uploading, onTap }: { logoUrl: string | null; uploading: boolean; onTap: (() => void) | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <button
        type="button"
        className="sb-tap"
        aria-label={logoUrl ? "Ganti foto toko" : "Tambah foto toko"}
        disabled={!onTap}
        onClick={onTap ?? undefined}
        style={{
          width: 68,
          height: 68,
          flex: "none",
          borderRadius: 18,
          overflow: "hidden",
          background: `linear-gradient(to bottom right, ${argb(0xffefe7d6)} 0%, ${argb(0xffefe7d6)} 50%, ${argb(0xffe7ddc8)} 50%, ${argb(0xffe7ddc8)} 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {uploading ? (
          <Spinner size={22} strokeWidth={2.5} color={C.terracotta} />
        ) : logoUrl ? (
          <FoodImage path={logoUrl} width={68} height={68} />
        ) : (
          <Icon name="add_a_photo_outlined" size={22} color={C.captionWarm} />
        )}
      </button>
      <Gap w={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={ui(14, { weight: 700, color: C.ink })}>Logo / foto toko</p>
        <Gap h={2} />
        <p style={ui(12.5, { color: C.muted })}>PNG atau JPG, maks 2MB</p>
      </div>
    </div>
  );
}

async function readCurrentStoreLocation(): Promise<StoreCurrentLocation | null> {
  const position = await appState.determineStoreLocation();
  if (position === null) {
    throw new StoreLocationInputException(appState.errorMessage ?? "Lokasi toko belum berhasil dibaca.");
  }
  const point: StoreGeoPoint = { latitude: position.latitude, longitude: position.longitude };
  if (!isValidStorePoint(point)) {
    throw new StoreLocationInputException("Perangkat memberikan koordinat yang tidak valid.");
  }
  return { point, accuracyMeters: position.accuracy };
}

function validateStoreName(value: string): string | null {
  const text = value.trim();
  if (text === "") return "Nama toko wajib diisi";
  if (text.length < 3) return "Minimal 3 karakter";
  if (text.length > 80) return "Maksimal 80 karakter";
  return null;
}

function validateAddress(value: string): string | null {
  const text = value.trim();
  if (text === "") return "Alamat wajib diisi";
  if (text.length < 8) return "Masukkan alamat lebih lengkap";
  if (text.length > 240) return "Maksimal 240 karakter";
  return null;
}

function validateTime(value: string): string | null {
  if (parseMerchantTimeMinutes(value) === null) return "Waktu tidak valid";
  return null;
}

function validateClosingTime(value: string, openText: string): string | null {
  const error = validateTime(value);
  if (error !== null) return error;
  const openMinutes = parseMerchantTimeMinutes(openText);
  const closeMinutes = parseMerchantTimeMinutes(value);
  if (openMinutes !== null && openMinutes === closeMinutes) return "Harus berbeda";
  return null;
}

/** `FocusScope.of(context).unfocus()`. */
function unfocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** `TextInputAction.next`: the keyboard action moves to the next field. */
function focusOnEnter(nextId: string) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    document.getElementById(nextId)?.focus();
  };
}

/** Keyboard access to a read-only field that opens a picker on tap. */
function activateOnKey(onTap: (() => void) | undefined) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (!onTap || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onTap();
  };
}
