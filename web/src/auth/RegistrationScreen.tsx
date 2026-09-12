import { useState, type FormEvent } from "react";
import { db } from "../db/database";
import { registerDevice } from "../db/registration";
import type { Location } from "../db/types";
import { formatActivationCodeInput } from "../domain/activationCode";
import { registrationStrings as S } from "./registrationStrings";

const ACTIVATION_CODE_LENGTH = "CLT-XXXX-XXXX-XXXX-XXXX".length;

interface RegistrationScreenProps {
  /** Called once the assistant taps "متابعة" on the success card — the app then re-checks device.token and renders normally. */
  onRegistered: () => void;
}

type ScreenState =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; locations: Location[]; locationId: string };

/**
 * Screen 1 (docs/reference/clintra-screens.html, "تسجيل الدخول (وقت
 * التركيب)"): shown once, install day only, by App.tsx whenever no device
 * row holds a real token yet. Three fields per the brief this task
 * follows — mobile, activation code, and (only surfaced when it would
 * otherwise be ambiguous) which of the organization's locations this
 * device serves. That third field is never a free pick: the activation
 * code itself already resolves a single, specific location server-side
 * (activation_codes.location_id) — this only ever *confirms* that
 * resolved location back to the installer, and only when the org has more
 * than one to distinguish between.
 *
 * No spinner-only state: the submit button's own label changes to
 * "جاري التفعيل…" while a request is in flight, so install day never
 * leaves the installer guessing whether to wait or retry. A failure —
 * wrong/expired/used code, a malformed phone, or a rate limit — always
 * shows the server's own Arabic message verbatim (db/registration.ts
 * never invents a "which field is wrong" guess of its own).
 */
export default function RegistrationScreen({ onRegistered }: RegistrationScreenProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<ScreenState>({ kind: "form" });

  const isSubmitting = state.kind === "submitting";

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (code.length < ACTIVATION_CODE_LENGTH) {
      setState({ kind: "error", message: S.invalidCode });
      return;
    }

    setState({ kind: "submitting" });
    const result = await registerDevice(db, { phone, activationCode: code });
    if (!result.ok) {
      setState({ kind: "error", message: result.message });
      return;
    }
    setState({ kind: "success", locations: result.locations, locationId: result.locationId });
  }

  if (state.kind === "success") {
    const servingLocation = state.locations.find((location) => location.id === state.locationId);
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper px-6"
        role="dialog"
        aria-modal="true"
        aria-label={S.formAria}
      >
        <h1 className="font-display text-3xl font-semibold text-green">Clintra</h1>
        <div className="mt-8 w-full max-w-[360px] rounded-[--radius-el] border border-line bg-paper p-6 text-center">
          <p className="font-display text-lg font-medium text-ink">{S.successTitle}</p>
          {state.locations.length > 1 && servingLocation && (
            <p className="mt-2 text-sm text-muted">
              {S.servingLocationPrefix} {servingLocation.name}
            </p>
          )}
          <button
            type="button"
            onClick={onRegistered}
            className="mt-6 w-full rounded-[--radius-el] bg-green px-4 py-3 text-paper"
          >
            {S.continueLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper px-6"
      role="dialog"
      aria-modal="true"
      aria-label={S.formAria}
    >
      <h1 className="font-display text-3xl font-semibold text-green">Clintra</h1>
      <p className="mb-6 mt-1 text-center text-sm text-muted">{S.title}</p>

      <form onSubmit={handleSubmit} className="flex w-full max-w-[360px] flex-col gap-1">
        <label className="text-sm text-muted" htmlFor="registration-phone">
          {S.phoneLabel}
        </label>
        <input
          id="registration-phone"
          type="tel"
          dir="ltr"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder={S.phonePlaceholder}
          disabled={isSubmitting}
          className="rounded-[--radius-el] border border-line bg-paper px-3 py-3 text-ink"
        />

        <label className="mt-4 text-sm text-muted" htmlFor="registration-code">
          {S.codeLabel}
        </label>
        <input
          id="registration-code"
          type="text"
          dir="ltr"
          autoComplete="off"
          value={code}
          onChange={(event) => setCode(formatActivationCodeInput(event.target.value))}
          placeholder={S.codePlaceholder}
          disabled={isSubmitting}
          maxLength={ACTIVATION_CODE_LENGTH}
          className="rounded-[--radius-el] border border-line bg-paper px-3 py-3 font-mono text-ink"
        />

        <p className="mt-3 min-h-5 text-sm text-red">{state.kind === "error" ? state.message : ""}</p>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-[--radius-el] bg-green px-4 py-3 text-paper disabled:opacity-60"
        >
          {isSubmitting ? S.submittingLabel : S.submitLabel}
        </button>
      </form>
    </div>
  );
}
