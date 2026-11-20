import { useState, type FormEvent } from "react";
import Button from "../components/ui/Button";
import Field, { TextInput } from "../components/ui/Field";
import { db } from "../db/database";
import type { DeviceRegistration, PersonCredential } from "../db/types";
import { changeOwnPassword, IdentityRequestError, signIn } from "./identityClient";
import { generatePinSalt, hashPin } from "./pinHash";

interface IdentityScreenProps {
  device: DeviceRegistration;
  changeFor?: PersonCredential;
  onCancel: () => void;
  onComplete: (membershipId?: string) => void;
}

export default function IdentityScreen({ device, changeFor, onCancel, onComplete }: IdentityScreenProps) {
  const [stage, setStage] = useState<"sign-in" | "password" | "pin">(changeFor ? "password" : "sign-in");
  const [person, setPerson] = useState(changeFor);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function finishSignIn(credential: PersonCredential) {
    const member = await db.memberships.get(credential.membership_id);
    if (!member) throw new IdentityRequestError("بيانات الحساب لسه بتنزل على الجهاز. جرّب تاني بعد المزامنة");
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
      if (stage === "sign-in") {
        const credential = await signIn(db, device, field("username").trim(), field("password"));
        setPerson(credential);
        if (credential.must_change_password) setStage("password");
        else await finishSignIn(credential);
      } else if (stage === "password" && person) {
        const newPassword = field("new-password");
        if (newPassword !== field("confirm-password")) throw new IdentityRequestError("كلمتا السر مش زي بعض");
        await changeOwnPassword(db, device, person, field("current-password"), newPassword);
        if (changeFor) onComplete();
        else await finishSignIn(person);
      } else if (person) {
        const pin = field("pin");
        if (!/^[0-9]{4}$/.test(pin) || pin !== field("confirm-pin")) throw new IdentityRequestError("اكتب نفس الـ 4 أرقام مرتين");
        const salt = generatePinSalt();
        const updated = await db.credentials.update(person.id, { pin_hash: hashPin(pin, salt), pin_salt: salt });
        if (!updated) throw new IdentityRequestError("سجّل الدخول على الجهاز ده تاني");
        onComplete(person.membership_id);
      }
    } catch (problem) {
      setError(problem instanceof IdentityRequestError ? problem.message : "تعذر الاتصال بالخادم. جرّب تاني");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form key={stage} className="mt-6 grid w-full max-w-xs gap-3 rounded-panel bg-card p-5 text-start text-text" onSubmit={submit}>
      <h1 className="text-lg font-bold">
        {stage === "sign-in" ? "دخول بحساب" : stage === "password" ? "غيّر كلمة السر" : "اختار رقم سري"}
      </h1>
      {stage === "sign-in" && (
        <>
          <Field id="identity-username" label="اسم المستخدم">
            <TextInput name="username" autoComplete="username" autoCapitalize="none" dir="ltr" spellCheck={false} required />
          </Field>
          <Field id="identity-password" label="كلمة السر">
            <TextInput name="password" type="password" autoComplete="current-password" required />
          </Field>
        </>
      )}
      {stage === "password" && (
        <>
          <Field id="identity-current-password" label="كلمة السر الحالية">
            <TextInput name="current-password" type="password" autoComplete="current-password" required />
          </Field>
          <Field id="identity-new-password" label="كلمة السر الجديدة">
            <TextInput name="new-password" type="password" autoComplete="new-password" required />
          </Field>
          <Field id="identity-confirm-password" label="اكتبها تاني">
            <TextInput name="confirm-password" type="password" autoComplete="new-password" required />
          </Field>
        </>
      )}
      {stage === "pin" && (
        <>
          <Field id="identity-pin" label="الرقم السري">
            <TextInput name="pin" type="password" inputMode="numeric" dir="ltr" maxLength={4} pattern="[0-9]{4}" required />
          </Field>
          <Field id="identity-confirm-pin" label="اكتبه تاني">
            <TextInput name="confirm-pin" type="password" inputMode="numeric" dir="ltr" maxLength={4} pattern="[0-9]{4}" required />
          </Field>
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} variant="primary" type="submit">{stage === "sign-in" ? "دخول" : "حفظ"}</Button>
        <Button disabled={busy} variant="secondary" type="button" onClick={onCancel}>رجوع</Button>
      </div>
    </form>
  );
}
