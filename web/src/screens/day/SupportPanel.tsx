import { useState } from "react";
import Button from "../../components/ui/Button";
import Switch from "../../components/ui/Switch";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { endSupportSession, mintSupportCode } from "../../sync/supportAccess";
import { ownerSupportSessionText, removeSupportSession, useSupportSessions } from "../../sync/supportSessions";
import { useOnlineStatus } from "../../sync/useOnlineStatus";
import { SetBody, SettingsFooter } from "./SettingsLayout";
import Sheet from "./Sheet";

export default function SupportPanel({ orgId }: { orgId: string }) {
  const locations = useLiveQuery(async () => (await db.locations.toArray()).filter((row) => row.org_id === orgId && row.is_active), [orgId]) ?? [];
  const sessions = useSupportSessions();
  const online = useOnlineStatus();
  const [hours, setHours] = useState<"1" | "24" | "72">("24");
  const [locationId, setLocationId] = useState("");
  const [includeClinical, setIncludeClinical] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const chosenLocation = locations.some((row) => row.id === locationId) ? locationId : locations[0]?.id;

  async function create() {
    if (!online || !chosenLocation || busy) return;
    setBusy(true);
    setMessage("");
    try { setCode(await mintSupportCode(db, chosenLocation, Number(hours) as 1 | 24 | 72, includeClinical)); }
    catch { setMessage("الطلب ماكملش، حاول تاني"); }
    finally { setBusy(false); }
  }

  async function end(deviceId: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try { await endSupportSession(db, deviceId); removeSupportSession(deviceId); setConfirmId(null); }
    catch { setMessage("الطلب ماكملش، حاول تاني"); }
    finally { setBusy(false); }
  }

  return <>
    <SetBody>
      <div data-support-write className="flex flex-col gap-4 rounded-card border border-rule bg-card p-4">
        <h3 className="font-semibold">إنشاء كود دعم</h3>
        {!online && <p role="alert" className="text-[12.5px] text-danger">إنشاء كود الدعم محتاج اتصال بالإنترنت</p>}
        <div className="space-y-2"><p className="text-xs font-bold text-muted">المدة</p>
          <ToggleGroup variant="filter" label="المدة" value={hours} onChange={setHours} options={[
            { value: "1", label: "ساعة" }, { value: "24", label: "24 ساعة" }, { value: "72", label: "72 ساعة" },
          ]} />
        </div>
        <label className="flex flex-col gap-2 text-xs font-bold text-muted" htmlFor="support-location">الفرع
          <select id="support-location" className="w-full rounded-control border-[1.5px] border-rule bg-field px-[13px] py-2.5 font-[inherit] text-[15px] font-semibold text-text focus:border-green focus:bg-card focus:outline-none" value={chosenLocation ?? ""} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between gap-4 text-sm"><span>يشمل البيانات الطبية</span><Switch label="يشمل البيانات الطبية" checked={includeClinical} onCheckedChange={setIncludeClinical} /></div>
        <Button variant="primary" disabled={!online || !chosenLocation || busy} onClick={create}>إنشاء كود دعم</Button>
        {code && <div role="status" className="rounded-card border border-copper-line bg-copper-wash p-3 text-sm text-copper-ink">
          <p>كود الدعم: <bdi dir="ltr">{code}</bdi> — ابعته لفريق كلينترا بس، وبيخلص بعد 72 ساعة لو ماتستخدمش</p>
          <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(code)}>نسخ الكود</Button>
        </div>}
        {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      </div>
      {sessions.map((session) => <div key={session.device_id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-rule bg-card p-4">
        <p>{ownerSupportSessionText(session.admin_name, session.expires_at)}</p>
        <Button variant="danger" size="sm" disabled={!online || busy} onClick={() => setConfirmId(session.device_id)}>إنهاء الدعم دلوقتي</Button>
      </div>)}
    </SetBody>
    <SettingsFooter />
    {confirmId && <Sheet onDismiss={() => setConfirmId(null)}>
      <div className="flex flex-col gap-4 p-5"><h3 className="text-base font-semibold">إنهاء الدعم دلوقتي</h3>
        <p className="text-sm text-muted">تنهي وصول جهاز الدعم دلوقتي؟</p>
        <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy} onClick={() => void end(confirmId)}>تأكيد الإنهاء</Button>
          <Button variant="secondary" onClick={() => setConfirmId(null)}>إلغاء</Button></div>
      </div>
    </Sheet>}
  </>;
}
