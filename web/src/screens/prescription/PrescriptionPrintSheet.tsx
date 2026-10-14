import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useGuardedActingMembership } from "../../auth/useActingMembership";
import Button from "../../components/ui/Button";
import { SheetPanelBody, SheetPanelFoot } from "../../components/ui/SheetPanel";
import { db } from "../../db/database";
import { markPrescriptionPrinted } from "../../db/prescriptions";
import { MessageChannel, type Patient, type Practitioner, type Prescription, type PrescriptionItem, type Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { findGeneralFormDefinition, findVisitFormData, readVisitFormValues, type VisitFormFieldValues } from "../../db/visitForm";
import Sheet from "../day/Sheet";
import SheetHeader from "../day/SheetHeader";
import { usePrintClinic } from "../day/usePrintClinic";
import { prescriptionMessageText } from "../messages/messagesModel";
import SendMessageSheet from "../messages/SendMessageSheet";
import { messagesStrings } from "../messages/strings";
import { MessageTemplateKey } from "../../domain/messageTemplates";
import { buildRxPrintModel, computeRxPrintState, rxPrintErrorMessage } from "./printModel";
import RxPrintPage from "./RxPrintPage";
import { prescriptionPrintStrings as T } from "./strings";

interface PrescriptionPrintSheetProps {
  prescriptionId: string;
  onDismiss: () => void;
}

interface PrintData {
  prescription: Prescription;
  items: PrescriptionItem[];
  visit: Visit;
  visitForm: VisitFormFieldValues;
  patient: Patient | undefined;
  practitioner: Practitioner | undefined;
}

/**
 * The printed prescription (reference screen 16, "الوصفة — للطباعة"): the
 * `.rx-print-page` preview in a sheet, and `.split`'s one action, "طباعة /
 * حفظ PDF" — the browser's print dialog both prints and saves a PDF.
 * Opened from the visit workspace's `.rx-section`; the patient profile
 * (screen 18) will open it too.
 *
 * The first print locks the prescription for good (markPrescriptionPrinted),
 * so it is the visit's practitioner's alone and is confirmed in the sheet
 * first; only once the write has landed — and the page shows the
 * prescription as printed — does the print dialog open. A printed one
 * reprints for anyone who can see it, straight to the dialog, with no write.
 * Any refusal is shown and the dialog does not open (computeRxPrintState
 * and rxPrintErrorMessage).
 *
 * Rendered into a body-level portal: the workspace that opens it may sit
 * inside a print-hidden screen or under the visit sheet, and the print
 * target must be the only thing on paper (index.css, `.rx-print-target`,
 * which also sets the A5 page). Like every printed page, the preview is
 * `print:hidden` and the flat target `hidden print:block`, mounted only
 * while a print is under way.
 *
 * Once printed — and only then — "واتساب" and "SMS" open the send sheet
 * over this one with the custom template preselected and the prescription
 * as its text (messagesModel.ts's prescriptionMessageText), on that channel.
 */
export default function PrescriptionPrintSheet({ prescriptionId, onDismiss }: PrescriptionPrintSheetProps) {
  const actingPractitionerId = useGuardedActingMembership()?.practitioner_id ?? null;
  const [isConfirming, setIsConfirming] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every print request, so each one opens the dialog once; null
  // once the browser reports the dialog closed.
  const [printRun, setPrintRun] = useState<number | null>(null);
  const [sendChannel, setSendChannel] = useState<MessageChannel | null>(null);

  const data = useLiveQuery<PrintData | null>(async () => {
    const prescription = await db.prescriptions.get(prescriptionId);
    const visit = prescription ? await db.visits.get(prescription.visit_id) : undefined;
    if (!prescription || !visit) {
      return null;
    }
    const [items, formDefinition, patient, practitioner] = await Promise.all([
      db.prescription_items.where("prescription_id").equals(prescriptionId).toArray(),
      findGeneralFormDefinition(db),
      db.patients.get(prescription.patient_id),
      db.practitioners.get(prescription.practitioner_id),
    ]);
    const visitForm = readVisitFormValues(await findVisitFormData(db, visit.id, formDefinition.id));
    return { prescription, items, visit, visitForm, patient, practitioner };
  }, [prescriptionId]);

  const clinic = usePrintClinic(data?.prescription.location_id ?? "");
  const isPrinted = data?.prescription.printed_at != null;

  useEffect(() => {
    // The first print waits for the printed row, so paper carries its date
    // and diagnosis snapshot.
    if (printRun === null || !isPrinted) {
      return;
    }
    window.print();
    function handleAfterPrint() {
      setPrintRun(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, [printRun, isPrinted]);

  if (!data) {
    return createPortal(
      <Sheet onDismiss={onDismiss} size="lg">
        <SheetHeader title={T.sheetTitle} onDismiss={onDismiss} />
        <SheetPanelBody>
          <p className="text-muted">{T.loadingLabel}</p>
        </SheetPanelBody>
      </Sheet>,
      document.body,
    );
  }

  const model = buildRxPrintModel({ ...data, clinic, now: new Date() });
  const state = computeRxPrintState(actingPractitionerId, data.visit, data.prescription, data.items.length);

  function requestPrint() {
    setPrintRun((run) => (run ?? 0) + 1);
  }

  function handlePrint() {
    setError(null);
    switch (state.step.kind) {
      case "refuse":
        setError(state.step.message);
        return;
      case "print":
        requestPrint();
        return;
      case "confirm":
        setIsConfirming(true);
    }
  }

  async function handleConfirm() {
    setIsWriting(true);
    try {
      await markPrescriptionPrinted(db, prescriptionId);
      setIsConfirming(false);
      requestPrint();
    } catch (caught) {
      setIsConfirming(false);
      setError(rxPrintErrorMessage(caught));
    } finally {
      setIsWriting(false);
    }
  }

  return createPortal(
    <>
      <div className="print:hidden">
        <Sheet onDismiss={onDismiss} size="lg">
          <SheetHeader title={T.sheetTitle} onDismiss={onDismiss} />
          <SheetPanelBody>
            <RxPrintPage model={model} preview />
          </SheetPanelBody>
          {/* `.split` */}
          <SheetPanelFoot>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {isPrinted && !isConfirming && (
                <>
                  <Button variant="secondary" onClick={() => setSendChannel(MessageChannel.WhatsApp)}>
                    {messagesStrings.rxSendWhatsApp}
                  </Button>
                  <Button variant="secondary" onClick={() => setSendChannel(MessageChannel.Sms)}>
                    {messagesStrings.rxSendSms}
                  </Button>
                </>
              )}
              {isConfirming ? (
                <>
                  <p className="basis-full text-[13px] font-semibold text-text">{T.confirmQuestion}</p>
                  <Button variant="primary" className="flex-1" disabled={isWriting} onClick={() => void handleConfirm()}>
                    {T.confirmPrint}
                  </Button>
                  <Button variant="secondary" disabled={isWriting} onClick={() => setIsConfirming(false)}>
                    {T.confirmBack}
                  </Button>
                </>
              ) : (
                <Button variant="primary" className="flex-1" onClick={handlePrint}>
                  {T.printAction}
                </Button>
              )}
              {error && (
                <p role="alert" className="basis-full text-[12.5px] font-semibold text-danger">
                  {error}
                </p>
              )}
            </div>
          </SheetPanelFoot>
        </Sheet>
      </div>

      {sendChannel !== null && (
        <SendMessageSheet
          visitId={data.prescription.visit_id}
          start={{
            templateKey: MessageTemplateKey.Custom,
            channel: sendChannel,
            body: prescriptionMessageText({
              prescription: data.prescription,
              items: data.items,
              patientName: data.patient?.full_name ?? null,
              doctorName: data.practitioner?.full_name ?? null,
            }),
          }}
          onDismiss={() => setSendChannel(null)}
        />
      )}

      {printRun !== null && isPrinted && (
        <div className="rx-print-target hidden print:block">
          <RxPrintPage model={model} preview={false} />
        </div>
      )}
    </>,
    document.body,
  );
}
