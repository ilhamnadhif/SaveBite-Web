"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { AppTextField, FieldError, FieldLabel, Screen, Scroll, SimpleHeader, Spinner, safeBottom } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

type Field = "name" | "email" | "phone";
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string | null>>;

function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Nama wajib diisi";
  if (name.length < 2) return "Nama minimal 2 karakter";
  if (name.length > 80) return "Nama maksimal 80 karakter";
  return null;
}

function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Email wajib diisi";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Format email tidak valid";
  return null;
}

function validatePhone(value: string): string | null {
  const phone = value.trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "Nomor telepon harus 8–15 digit";
  return null;
}

const VALIDATORS: Record<Field, (value: string) => string | null> = {
  name: validateName,
  email: validateEmail,
  phone: validatePhone,
};

/**
 * While saving the fields are disabled, and a `TextFormField` without a
 * `disabledBorder` falls back to M3's filled underline (1 px onSurface @ 38 %,
 * top corners r4) instead of its outline.
 */
const SAVING_FIELD: CSSProperties = { borderRadius: "4px 4px 0 0", boxShadow: "0 1px 0 rgba(23, 29, 26, 0.38)" };

/** Consumer profile editing with validation, upload state, and error handling. */
export function EditProfileScreen() {
  const [values, setValues] = useState<Values>(() => ({
    name: appState.userName,
    email: appState.userEmail,
    phone: appState.userPhone,
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => appState.userAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const fieldId = (field: Field) => `${id}-${field}`;
  const dismissKeyboardOnDrag = useKeyboardDismissOnDrag();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // AutovalidateMode.onUserInteraction: an edited field revalidates on every change.
  const change = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: VALIDATORS[field](value) }));
  };

  const validate = (): boolean => {
    const next: Errors = {
      name: validateName(values.name),
      email: validateEmail(values.email),
      phone: validatePhone(values.phone),
    };
    setErrors(next);
    return !next.name && !next.email && !next.phone;
  };

  const changePhoto = async () => {
    if (uploading || saving) return;
    // Called first, synchronously inside the tap: browsers only open the file
    // chooser during the user's gesture.
    const picked = (async () => appState.uploadImage("avatar"))();
    setUploading(true);
    try {
      const url = await picked;
      if (url !== null && alive.current) setAvatarUrl(url);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof BackendException) snack(error.message, "error_outline");
      else snack("Foto gagal diunggah. Periksa koneksi lalu coba lagi.", "error_outline");
    } finally {
      if (alive.current) setUploading(false);
    }
  };

  const save = async () => {
    if (saving || uploading) return;
    unfocus();
    if (!validate()) {
      snack("Periksa kembali data profil.", "error_outline");
      return;
    }
    setSaving(true);
    try {
      const requestedEmail = values.email.trim().toLowerCase();
      const emailChanged = requestedEmail !== appState.userEmail.toLowerCase();
      await appState.updateProfile({
        name: values.name.trim(),
        email: requestedEmail,
        phone: values.phone.trim(),
        avatarUrl: avatarUrl ?? undefined,
      });
      if (!alive.current) return;
      snack(
        emailChanged && appState.userEmail.toLowerCase() !== requestedEmail
          ? "Profil disimpan. Konfirmasi alamat email baru melalui tautan yang dikirim."
          : "Profil disimpan",
      );
      void AppNav.pop(true);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof BackendException) snack(error.message, "error_outline");
      else snack("Profil gagal disimpan. Periksa koneksi lalu coba lagi.", "error_outline");
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  // TextInputAction.next / .done.
  const onEnter = (next: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    next();
  };
  const focusField = (field: Field) => () => document.getElementById(fieldId(field))?.focus();

  const fieldProps = (field: Field) => ({
    id: fieldId(field),
    value: values[field],
    onChange: (event: ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
    disabled: saving,
    invalid: Boolean(errors[field]),
    borderColor: saving ? "transparent" : C.inputBorder,
    containerStyle: saving ? SAVING_FIELD : undefined,
    style: { caretColor: C.greenBright },
  });

  const photoBusy = uploading || saving;

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Edit Profil" />
      <Scroll style={{ padding: "18px 24px 24px" }} {...dismissKeyboardOnDrag}>
        <form noValidate autoComplete="on" onSubmit={(event) => event.preventDefault()}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              className="sb-tap"
              aria-label="Ubah foto profil"
              disabled={photoBusy}
              onClick={() => void changePhoto()}
              style={{ position: "relative", width: 84, height: 84, borderRadius: "50%", flex: "none" }}
            >
              <EditAvatar url={avatarUrl} initials={appState.userInitials} />
              <span
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -2,
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: C.green,
                  border: `2.5px solid ${C.cream}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {uploading ? (
                  <Spinner size={14} strokeWidth={2} color={C.cream} />
                ) : (
                  <Icon name="photo_camera_outlined" size={15} color={C.cream} />
                )}
              </span>
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <TextButton
              label={
                <span style={ui(13.5, { weight: 700, color: C.greenAccent })}>{uploading ? "Mengunggah…" : "Ubah foto"}</span>
              }
              onTap={photoBusy ? null : () => void changePhoto()}
            />
          </div>
          <div style={{ marginTop: 20 }}>
            <FieldLabel htmlFor={fieldId("name")}>Nama</FieldLabel>
            <AppTextField
              {...fieldProps("name")}
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              onKeyDown={onEnter(focusField("email"))}
            />
            <FieldError>{errors.name}</FieldError>
          </div>
          <div style={{ marginTop: 18 }}>
            <FieldLabel htmlFor={fieldId("email")}>Email</FieldLabel>
            <AppTextField
              {...fieldProps("email")}
              type="text"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              onKeyDown={onEnter(focusField("phone"))}
            />
            <FieldError>{errors.email}</FieldError>
          </div>
          <div style={{ marginTop: 18 }}>
            <FieldLabel htmlFor={fieldId("phone")}>No. HP (opsional)</FieldLabel>
            <AppTextField
              {...fieldProps("phone")}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="done"
              onKeyDown={onEnter(() => void save())}
            />
            <FieldError>{errors.phone}</FieldError>
          </div>
        </form>
      </Scroll>
      <div
        style={{
          flex: "none",
          background: C.cream,
          borderTop: `1px solid ${C.border}`,
          padding: "14px 24px",
          paddingBottom: safeBottom(14),
        }}
      >
        <PrimaryButton label={saving ? "Menyimpan…" : "Simpan perubahan"} onTap={saving || uploading ? null : () => void save()} />
      </div>
    </Screen>
  );
}

/** `ClipOval(Image.network)` falling back to the initials when it fails. */
function EditAvatar({ url, initials }: { url: string | null; initials: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        width={84}
        height={84}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 84,
        height: 84,
        borderRadius: "50%",
        background: C.amberAvatar,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...display(30, { color: C.green }),
      }}
    >
      {initials}
    </span>
  );
}

/** `FocusScope.of(context).unfocus()`. */
function unfocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * `keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag`: a
 * scroll drag past the touch slop closes the keyboard.
 */
function useKeyboardDismissOnDrag() {
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (event: TouchEvent<HTMLDivElement>) => {
      startY.current = event.touches[0]?.clientY ?? null;
    },
    onTouchMove: (event: TouchEvent<HTMLDivElement>) => {
      const start = startY.current;
      const y = event.touches[0]?.clientY;
      if (start === null || y === undefined || Math.abs(y - start) < 18) return;
      startY.current = null;
      unfocus();
    },
  };
}
