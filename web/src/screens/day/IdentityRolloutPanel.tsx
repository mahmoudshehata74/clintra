import { useEffect, useState, type FormEvent } from "react";
import IdentityScreen from "../../auth/IdentityScreen";
import { IdentityRequestError, requestStaffIdentity } from "../../auth/identityClient";
import text from "../../auth/identityStrings";
import PasswordInput from "../../auth/PasswordInput";
import { memberNextStep, rolloutUnsignedCount, useDeviceAccount, type RolloutStatus } from "../../auth/rollout";
import { setActiveMembershipId } from "../../auth/session";
import Button from "../../components/ui/Button";
import Field from "../../components/ui/Field";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { staffName } from "../../domain/staffName";
import { SetBody } from "./SettingsLayout";

const date = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "medium", timeZone: "Africa/Cairo" });
const failureText = (error: unknown) => error instanceof IdentityRequestError ? error.message : text.connectionFailed;

export default function IdentityRolloutPanel({ ownerId }: { ownerId: string }) {
  const account = useDeviceAccount(ownerId);
  const [setup, setSetup] = useState(false);
  return (
    <SetBody>
      {account && setup ? (
        <IdentityScreen device={account.device} firstSetup onCancel={() => setSetup(false)} onComplete={(id) => {
          if (id) setActiveMembershipId(id);
          setSetup(false);
        }} />
      ) : account?.credential ? (
        <Readiness key={account.credential.id} ownerId={ownerId} deviceId={account.device.id} />
      ) : account ? (
        <div className="grid gap-3">
          <p>{text.rolloutSetupHint}</p>
          <p className="text-sm text-muted">{text.rolloutSignInHint}</p>
          <div><Button variant="primary" onClick={() => setSetup(true)}>{text.rolloutSetup}</Button></div>
        </div>
      ) : <p role="status">{text.rolloutLoading}</p>}
    </SetBody>
  );
}

function Readiness({ ownerId, deviceId }: { ownerId: string; deviceId: string }) {
  const [status, setStatus] = useState<RolloutStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [revision, setRevision] = useState(0);
  const local = useLiveQuery(async () => {
    const members = await db.memberships.toArray();
    const users = await db.users.bulkGet(members.map((member) => member.user_id));
    return {
      unsigned: await rolloutUnsignedCount(db, deviceId),
      locations: new Map((await db.locations.toArray()).map((location) => [location.id, location.name])),
      names: new Map(members.map((member, index) => [member.id, staffName(member, users[index])])),
      enforced: Boolean((await db.device.get(deviceId))?.identity_enforced_at),
    };
  }, [deviceId]);
  const enforced = local?.enforced ?? false;

  useEffect(() => {
    let ignore = false;
    requestStaffIdentity<RolloutStatus>(db, ownerId, "GET", "/auth/rollout").then(
      (next) => { if (!ignore) setStatus(next); },
      (problem: unknown) => { if (!ignore) setError(failureText(problem)); },
    );
    return () => { ignore = true; };
  }, [ownerId, revision, enforced]);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !status?.ready || status.identity_enforced_at) return;
    const password = String(new FormData(event.currentTarget).get("password"));
    setBusy(true);
    setError(undefined);
    try {
      const next = await requestStaffIdentity<RolloutStatus>(db, ownerId, "POST", "/auth/rollout/enable", { password });
      setStatus(next);
      setConfirm(false);
    } catch (problem) {
      setError(failureText(problem));
      setRevision((previous) => previous + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!status && !error && <p role="status">{text.rolloutLoading}</p>}
      {status && (
        <>
          {status.identity_enforced_at ? <p role="status">{text.rolloutEnabled}</p> : (
            <>
              {status.ready && <p role="status">{text.rolloutReady}</p>}
              {status.waiting && <p className="text-sm text-danger">{text.rolloutWaiting}</p>}
              {status.blockers.length > 0 && (
                <ul className="list-disc space-y-1 ps-5 text-sm text-danger">
                  {status.blockers.map((reason) => <li key={reason}>{text[reason]}</li>)}
                </ul>
              )}
              {status.auto_at && <p className="text-sm">{text.rolloutDate} <time dateTime={status.auto_at}>{date.format(new Date(status.auto_at))}</time></p>}
            </>
          )}
          <ul aria-label={text.rolloutMembers} className="divide-y divide-hair rounded-card border border-hair">
            {status.members.map((member) => (
              <li key={member.id} className="px-3 py-2">
                <span className="font-semibold">{member.display_name ?? local?.names.get(member.id) ?? text.rolloutUnnamedMember}</span>
                <p className="text-sm text-muted">{text[memberNextStep(member)]}</p>
              </li>
            ))}
          </ul>
          <ul aria-label={text.rolloutDevices} className="divide-y divide-hair rounded-card border border-hair">
            {status.devices.map((device) => (
              <li key={device.id} className="px-3 py-2">
                <span className="font-semibold">{[text.device + " " + device.series, local?.locations.get(device.location_id)].filter(Boolean).join(" · ")}</span>
                <p className="text-sm text-muted">{device.bound ? text.rolloutComplete : text.rolloutDeviceSignIn}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm">{text.rolloutUnsigned}: <bdi dir="ltr" className="font-bold tabular-nums">{local?.unsigned ?? 0}</bdi></p>
          {confirm && status.ready && !status.identity_enforced_at && (
            <form data-support-write className="grid gap-3 rounded-card border border-hair bg-card p-3" onSubmit={enable}>
              <Field id="identity-rollout-password" label={text.stepUpPassword}>
                <PasswordInput name="password" autoComplete="current-password" required />
              </Field>
              <div className="flex gap-2">
                <Button variant="danger" type="submit" disabled={busy}>{text.rolloutEnable}</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>{text.back}</Button>
              </div>
            </form>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {status && !status.identity_enforced_at && !confirm && <Button variant="primary" disabled={!status.ready} onClick={() => setConfirm(true)}>{text.rolloutEnable}</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => {
          setError(undefined);
          setRevision((previous) => previous + 1);
        }}>{text.rolloutRefresh}</Button>
      </div>
    </div>
  );
}
