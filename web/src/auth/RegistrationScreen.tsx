import { useState, type FormEvent, type ReactNode } from "react";
import Button from "../components/ui/Button";
import Field, { TextInput } from "../components/ui/Field";
import { db } from "../db/database";
import { registerDevice } from "../db/registration";
import type { Location } from "../db/types";
import { useLiveQuery } from "../db/useLiveQuery";
import { formatActivationCodeInput } from "../domain/activationCode";
import { placeActivationError, type ActivationError } from "./activationForm";
import { registrationStrings as S } from "./registrationStrings";

const ACTIVATION_CODE_LENGTH = "CLT-XXXX-XXXX-XXXX-XXXX".length;

interface RegistrationScreenProps {
  /** Called once the installer taps "ابدأ" on the confirmation — the app then re-checks device.token and renders normally. */
  onRegistered: () => void;
}

type ScreenState =
  | { kind: "form"; error: ActivationError | null }
  | { kind: "submitting" }
  | { kind: "success"; locations: Location[]; locationId: string };

/**
 * `.install-scr` — the card on the paper background, with its `.install-hero`
 * (copper→green top strip, `.logo` tile, `.t` "Clintra", `.s` subtitle).
 * Shared by the form and the confirmation so both read as one card.
 */
function InstallCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-paper px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={S.formAria}
    >
      <div className="w-full max-w-[440px] overflow-hidden rounded-app border border-rule bg-card shadow-l">
        <div className="relative overflow-hidden bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_100%)] px-7 pb-[22px] pt-9 text-center text-on-dark before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-[linear-gradient(to_left,var(--color-copper)_0%,var(--color-green-2)_45%,transparent_85%)] before:content-['']">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-panel bg-[linear-gradient(135deg,var(--color-green-2)_0%,var(--color-green)_100%)] text-[26px] font-bold text-white shadow-[0_8px_20px_rgba(0,0,0,.35)]">
            C
          </div>
          <p className="text-[22px] font-bold tracking-[-0.01em] text-white">{S.brandName}</p>
          <h1 className="mt-[5px] text-xs font-normal text-on-dark-dim">{S.title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Device activation, prototype #s15 (`.install-scr`, `.install-hero`,
 * `.logo`, `.t`, `.s`, `.install-body`, `.field`, `.in`, `.hint`,
 * `.install-foot`): shown once, install day only, by App.tsx whenever no
 * device row holds a real token yet. Exactly the two credentials settled in
 * docs/auth-plan.md, in the prototype's order — the activation code, then
 * the owner's phone; there is no SMS verification field (settled
 * deviation). The activation code itself resolves one specific location
 * server-side (activation_codes.location_id).
 *
 * No spinner-only state: the submit button's own label changes to
 * "جاري التفعيل…" while a request is in flight. A server refusal shows the
 * server's own Arabic message verbatim, for the form as a whole
 * (db/registration.ts never guesses which field is wrong); the two checks
 * made on the device — an incomplete code, a phone that does not
 * normalize — show on their own fields (activationForm.ts).
 *
 * The prototype's "the device will be registered to <clinic>" note is not
 * shown before activation (settled deviation): the clinic isn't known
 * until the code is accepted. After it is, the same card confirms
 * "اتربط الجهاز بعيادة {name}" — the organization row registration just
 * stored locally, nothing fetched — with "ابدأ" to continue to the lock
 * screen.
 */
export default function RegistrationScreen({ onRegistered }: RegistrationScreenProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<ScreenState>({ kind: "form", error: null });

  const isSubmitting = state.kind === "submitting";

  const servingLocation = state.kind === "success" ? state.locations.find((location) => location.id === state.locationId) : undefined;
  const organizationName = useLiveQuery(
    async () => (servingLocation ? ((await db.organizations.get(servingLocation.org_id))?.name ?? null) : null),
    [servingLocation?.org_id],
  );

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (code.length < ACTIVATION_CODE_LENGTH) {
      setState({ kind: "form", error: { kind: "incomplete_code" } });
      return;
    }

    setState({ kind: "submitting" });
    const result = await registerDevice(db, { phone, activationCode: code });
    if (!result.ok) {
      setState({ kind: "form", error: { kind: "server", message: result.message } });
      return;
    }
    setState({ kind: "success", locations: result.locations, locationId: result.locationId });
  }

  if (state.kind === "success") {
    return (
      <InstallCard>
        <div className="flex flex-col gap-1.5 px-6 py-[22px] text-center">
          <p className="text-[15px] font-semibold text-text">
            {S.confirmationPrefix} {organizationName ?? ""}
          </p>
          {/* Only when the organization has more than one location, so it isn't obvious which one this device serves. */}
          {state.locations.length > 1 && servingLocation && (
            <p className="text-[12.5px] text-muted">
              {S.servingLocationPrefix} {servingLocation.name}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-hair bg-field px-6 py-4">
          <Button variant="primary" className="w-full" onClick={onRegistered}>
            {S.startLabel}
          </Button>
        </div>
      </InstallCard>
    );
  }

  const errors = placeActivationError(state.kind === "form" ? state.error : null, {
    incompleteCode: S.invalidCode,
    invalidPhone: S.invalidPhone,
  });

  return (
    <InstallCard>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-[14px] px-6 py-[22px]">
          <Field label={S.codeLabel} id="registration-code" hint={S.codeHint} error={errors.code}>
            <TextInput
              type="text"
              dir="ltr"
              variant="mono"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(formatActivationCodeInput(event.target.value))}
              placeholder={S.codePlaceholder}
              disabled={isSubmitting}
              maxLength={ACTIVATION_CODE_LENGTH}
            />
          </Field>
          <Field label={S.phoneLabel} id="registration-phone" error={errors.phone}>
            <TextInput
              type="tel"
              dir="ltr"
              variant="mono"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={S.phonePlaceholder}
              disabled={isSubmitting}
            />
          </Field>
          {errors.form && (
            <p role="alert" className="text-[12.5px] text-danger">
              {errors.form}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-hair bg-field px-6 py-4">
          <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? S.submittingLabel : S.submitLabel}
          </Button>
        </div>
      </form>
    </InstallCard>
  );
}
