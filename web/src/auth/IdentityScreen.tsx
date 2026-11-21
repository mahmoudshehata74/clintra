import text from "./identityStrings";
import { useState, type FormEvent } from "react";
import Button from "../components/ui/Button";
import Field, { TextInput } from "../components/ui/Field";
import { db } from "../db/database";
import type { DeviceRegistration, PersonCredential } from "../db/types";
import { changeOwnPassword, IdentityRequestError, recoverOwner, signIn } from "./identityClient";
import { generatePinSalt, hashPin } from "./pinHash";
import PasswordInput from "./PasswordInput";

interface IdentityScreenProps {
  device: DeviceRegistration;
  changeFor?: PersonCredential;
  firstSetup?: boolean;
  onCancel: () => void;
  onComplete: (membershipId?: string) => void;
}

export default function IdentityScreen({ device, changeFor, firstSetup, onCancel, onComplete }: IdentityScreenProps) {
  const [stage, setStage] = useState<"sign-in" | "password" | "pin" | "recovery">(firstSetup ? "recovery" : changeFor ? "password" : "sign-in");
  const [person, setPerson] = useState(changeFor);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function finishSignIn(credential: PersonCredential) {
    const member = await db.memberships.get(credential.membership_id);
    if (!member) throw new IdentityRequestError(text.accountSync);
    if (!member.pin_salt && !credential.pin_salt) {
      setStage("pin");
      return;
    }
    onComplete(member.id);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    setBusy(true);
    setError(undefined);
    try {
      if (stage === "sign-in" || stage === "recovery") {
        const username = field("username").trim();
        const password = field("password");
        const credential = stage === "recovery"
          ? await recoverOwner(db, device, { username, password, phone: field("phone"), code: field("code") })
          : await signIn(db, device, username, password);
        setPerson(credential);
        if (credential.must_change_password) setStage("password");
        else await finishSignIn(credential);
      } else if (stage === "password" && person) {
        const newPassword = field("new-password");
        if (newPassword !== field("confirm-password")) throw new IdentityRequestError(text.passwordMismatch);
        await changeOwnPassword(db, device, person, field("current-password"), newPassword);
        if (changeFor) onComplete();
        else await finishSignIn(person);
      } else if (person) {
        const pin = field("pin");
        if (!/^[0-9]{4}$/.test(pin) || pin !== field("confirm-pin")) throw new IdentityRequestError(text.pinMismatch);
        const salt = generatePinSalt();
        const updated = await db.credentials.update(person.id, { pin_hash: hashPin(pin, salt), pin_salt: salt });
        if (!updated) throw new IdentityRequestError(text.signInAgain);
        onComplete(person.membership_id);
      }
    } catch (problem) {
      setError(problem instanceof IdentityRequestError ? problem.message : text.connectionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form key={stage} className="mt-6 grid w-full max-w-xs gap-3 rounded-panel bg-card p-5 text-start text-text" onSubmit={submit}>
      <h1 className="text-lg font-bold">
        {stage === "sign-in" ? text.signIn : stage === "password" ? text.changePassword : stage === "recovery"
          ? (firstSetup ? text.rolloutSetup : text.recovery) : text.choosePin}
      </h1>
      {stage === "recovery" && (
        <>
          <Field id="identity-recovery-phone" label={text.ownerPhone}>
            <TextInput type="tel" name="phone" autoComplete="tel" dir="ltr" placeholder="+20…" required />
          </Field>
          <Field id="identity-recovery-code" label={firstSetup ? text.activationCode : text.recoveryCode}>
            <TextInput name="code" autoComplete="one-time-code" dir="ltr" required />
          </Field>
        </>
      )}
      {(stage === "sign-in" || stage === "recovery") && (
        <>
          <Field id="identity-username" label={text.username}>
            <TextInput name="username" autoComplete="username" autoCapitalize="none" dir="ltr" spellCheck={false} required />
          </Field>
          <Field id="identity-password" label={stage === "recovery" ? text.newPassword : text.password}
            hint={stage === "recovery" ? text.passwordMinimumHint : undefined}>
            <PasswordInput name="password" autoComplete={stage === "recovery" ? "new-password" : "current-password"} required />
          </Field>
        </>
      )}
      {stage === "password" && (
        <>
          <Field id="identity-current-password" label={text.currentPassword}>
            <PasswordInput name="current-password" autoComplete="current-password" required />
          </Field>
          <Field id="identity-new-password" label={text.newPassword} hint={text.passwordMinimumHint}>
            <PasswordInput name="new-password" autoComplete="new-password" required />
          </Field>
          <Field id="identity-confirm-password" label={text.confirmPassword} hint={text.passwordMinimumHint}>
            <PasswordInput name="confirm-password" autoComplete="new-password" required />
          </Field>
        </>
      )}
      {stage === "pin" && (
        <>
          <Field id="identity-pin" label={text.pin}>
            <TextInput name="pin" type="password" inputMode="numeric" dir="ltr" maxLength={4} pattern="[0-9]{4}" required />
          </Field>
          <Field id="identity-confirm-pin" label={text.confirmPin}>
            <TextInput name="confirm-pin" type="password" inputMode="numeric" dir="ltr" maxLength={4} pattern="[0-9]{4}" required />
          </Field>
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} variant="primary" type="submit">{stage === "sign-in" ? text.submitSignIn : text.save}</Button>
        <Button disabled={busy} variant="secondary" type="button" onClick={stage === "recovery" && !firstSetup ? () => { setError(undefined); setStage("sign-in"); } : onCancel}>{text.back}</Button>
      </div>
      {stage === "sign-in" && (
        <a href="#owner-recovery" aria-disabled={busy} className="flex min-h-10 items-center text-start text-sm underline" onClick={(event) => {
          event.preventDefault();
          if (!busy) { setError(undefined); setStage("recovery"); }
        }}>
          {text.forgotPassword}
        </a>
      )}
    </form>
  );
}
