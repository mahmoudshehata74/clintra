import { useId, useState, type FormEvent } from "react";
import { IdentityRequestError, requestStaffIdentity } from "../../auth/identityClient";
import { canEditPermissions, canManageCredential, permissionCatalogue, type Permission } from "../../auth/permissions";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import { db } from "../../db/database";
import type { Location, Membership } from "../../db/types";

const text = {
  username: "اسم المستخدم",
  reset: "إعادة تعيين كلمة السر",
  devices: "الأجهزة اللي داخل منها",
  permissions: "الصلاحيات",
  revoke: "إلغاء الدخول من الجهاز ده",
  password: "اكتب كلمة السر بتاعتك للتأكيد",
  temporary: "كلمة السر المؤقتة",
  handOff: "اديها للموظف وهيغيّرها أول ما يدخل",
  copy: "نسخ",
  copied: "تم النسخ",
  copyFailed: "تعذر النسخ",
  unheld: "مش عندك الصلاحية دي",
  none: "مفيش أجهزة مسجّل دخول عليها",
  device: "جهاز",
  confirm: "تأكيد",
  back: "رجوع",
  failed: "تعذر الاتصال بالخادم. جرّب تاني",
} as const;

type Action = "username" | "reset" | "devices" | "permissions" | "revoke";
interface Credential { id: string; device_id: string; membership_id: string; location_id: string; series: number }
const permissions = Object.keys(permissionCatalogue) as Permission[];

export default function StaffIdentityActions({ caller, target, locations }: {
  caller: Membership; target: Membership; locations: Location[];
}) {
  const fieldId = useId();
  const [action, setAction] = useState<Action>();
  const [devices, setDevices] = useState<Credential[]>([]);
  const [selected, setSelected] = useState<Credential>();
  const [granted, setGranted] = useState<string[]>([]);
  const [temporary, setTemporary] = useState<string>();
  const [copyMessage, setCopyMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const owner = caller.role === "owner";
  const canRevoke = canManageCredential(caller, target);
  const canReset = canRevoke && caller.id !== target.id && Boolean(target.username);
  const canEdit = canEditPermissions(caller, target) && target.role !== "owner";
  const targetPath = `/staff/${target.id}`;

  function open(next?: Action) {
    setError(undefined);
    setCopyMessage(undefined);
    setTemporary(undefined);
    setGranted(target.permissions ?? []);
    setAction(next);
  }

  async function showDevices() {
    open("devices");
    setBusy(true);
    try {
      const { credentials } = await requestStaffIdentity<{ credentials: Credential[] }>(db, caller.id, "GET", "/staff/credentials");
      setDevices(credentials.filter((row) => row.membership_id === target.id));
    } catch (problem) {
      setError(problem instanceof IdentityRequestError ? problem.message : text.failed);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    setBusy(true);
    setError(undefined);
    try {
      if (action === "username" && owner) {
        const result = await requestStaffIdentity<{ username: string; rev: number }>(db, caller.id, "PUT", `${targetPath}/username`, { username: String(form.get("username")), password });
        await db.memberships.update(target.id, { username: result.username, rev: result.rev });
        open();
      } else if (action === "permissions" && canEdit) {
        const result = await requestStaffIdentity<{ permissions: string[]; rev: number }>(db, caller.id, "POST", targetPath, { permissions: granted, password });
        await db.memberships.update(target.id, { permissions: result.permissions, rev: result.rev });
        open();
      } else if (action === "reset" && canReset) {
        const result = await requestStaffIdentity<{ temporary_password: string }>(db, caller.id, "POST", `${targetPath}/password-reset`, { password });
        await db.credentials.filter((row) => row.membership_id === target.id).delete();
        setTemporary(result.temporary_password);
      } else if (action === "revoke" && canRevoke && selected) {
        await requestStaffIdentity(db, caller.id, "DELETE", `/staff/credentials/${selected.id}`, { password });
        await db.credentials.delete(selected.id);
        setDevices((rows) => rows.filter((row) => row.id !== selected.id));
        open("devices");
      }
    } catch (problem) {
      setError(problem instanceof IdentityRequestError ? problem.message : text.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!action) return (
    <div className="flex flex-wrap gap-2">
      {owner && <Button size="sm" variant="secondary" onClick={() => open("username")}>{text.username}</Button>}
      {canReset && <Button size="sm" variant="secondary" onClick={() => open("reset")}>{text.reset}</Button>}
      {canRevoke && <Button size="sm" variant="secondary" onClick={() => void showDevices()}>{text.devices}</Button>}
      {canEdit && <Button size="sm" variant="secondary" onClick={() => open("permissions")}>{text.permissions}</Button>}
    </div>
  );

  if ((action === "username" && !owner) || (action === "permissions" && !canEdit)
    || (action === "reset" && !canReset) || ((action === "revoke" || action === "devices") && !canRevoke)) return null;

  return (
    <section className="grid gap-3 rounded-card border border-hair bg-card p-4">
      <h3 className="font-semibold">{text[action]}</h3>
      {temporary ? (
        <div className="grid gap-2">
          <label htmlFor={`${fieldId}-temporary`}>{text.temporary}</label>
          <TextInput id={`${fieldId}-temporary`} dir="ltr" value={temporary} readOnly />
          <p className="text-sm">{text.handOff}</p>
          <Button size="sm" variant="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(temporary); setCopyMessage(text.copied); }
            catch { setCopyMessage(text.copyFailed); }
          }}>{text.copy}</Button>
          {copyMessage && <p role="status">{copyMessage}</p>}
        </div>
      ) : action === "devices" ? (
        <ul className="grid gap-2">
          {!busy && !error && devices.length === 0 && <li>{text.none}</li>}
          {devices.map((device) => <li className="flex flex-wrap items-center justify-between gap-2" key={device.id}>
            <span>{text.device} {device.series} · {locations.find((row) => row.id === device.location_id)?.name}</span>
            <Button size="sm" variant="danger" onClick={() => { setSelected(device); open("revoke"); }}>{text.revoke}</Button>
          </li>)}
        </ul>
      ) : (
        <form key={action} className="grid gap-3" onSubmit={submit}>
          {action === "username" && <Field id={`${fieldId}-username`} label={text.username}>
            <TextInput name="username" dir="ltr" defaultValue={target.username ?? ""} required maxLength={32} />
          </Field>}
          {action === "permissions" && <div className="grid gap-2 sm:grid-cols-2">
            {permissions.map((permission) => {
              const [label, description] = permissionCatalogue[permission];
              const disabled = !owner && !caller.permissions?.includes(permission);
              return <label key={permission} className="flex gap-2 rounded-card border border-hair p-2 text-sm">
                <input type="checkbox" role="switch" checked={granted.includes(permission)} disabled={disabled}
                  onChange={(event) => setGranted(event.target.checked ? [...granted, permission] : granted.filter((key) => key !== permission))} />
                <span><b>{label}</b><span className="block text-muted">{description}</span>{disabled && <span className="block text-muted">{text.unheld}</span>}</span>
              </label>;
            })}
          </div>}
          <Field id={`${fieldId}-password`} label={text.password}>
            <TextInput name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button size="sm" variant="primary" disabled={busy} type="submit">{text.confirm}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => open(action === "revoke" ? "devices" : undefined)}>{text.back}</Button>
    </section>
  );
}
