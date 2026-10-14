import { useState } from "react";
import { createPortal } from "react-dom";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import Field, { TextArea } from "../../components/ui/Field";
import { SheetPanelBody, SheetPanelFoot } from "../../components/ui/SheetPanel";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { carePlanSessionLabelForVisit } from "../../db/carePlans";
import { db } from "../../db/database";
import { MessageError, recordMessageAttempt } from "../../db/messages";
import { MessageChannel, type MessageTemplate, type Patient } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { effectiveBody, MESSAGE_TEMPLATES, type TemplateValues } from "../../domain/messageTemplates";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import Sheet from "../day/Sheet";
import SheetHeader from "../day/SheetHeader";
import { initialMessageText, missingValuesWarning, templateValuesForVisit } from "./messagesModel";
import { messagesStrings as T } from "./strings";

/** What the sheet starts from instead of the first template — the printed prescription's custom text and channel. */
export interface SendMessageStart {
  templateKey: string;
  body: string;
  channel: MessageChannel;
}

interface SendMessageSheetProps {
  visitId: string;
  start?: SendMessageStart;
  onDismiss: () => void;
}

interface SendData {
  patient: Patient | undefined;
  values: TemplateValues;
  overrides: Map<string, MessageTemplate>;
}

function sendErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case MessageError.PatientHasNoPhone:
      return T.errorNoPhone;
    case MessageError.BodyRequired:
      return T.errorBodyEmpty;
    case MessageError.PatientNotFound:
    case MessageError.VisitNotFound:
      return T.errorRecordMissing;
    default:
      return T.errorSendFailed;
  }
}

/**
 * Opens WhatsApp or SMS with a message for one visit's patient (the
 * prototype's `.msg-ch-toggle` lives here, not on the messages page). The
 * template picker fills the text from the template's effective body and the
 * visit's values (messagesModel.ts's templateValuesForVisit); the text is
 * editable, for this message only. A placeholder still unfilled is listed
 * as a warning that never blocks. Sending records the attempt
 * (recordMessageAttempt) and only then opens the link — `window.open` for
 * wa.me, the location for sms: — so a refusal (no phone, an empty text, a
 * device error) shows here and opens nothing.
 *
 * Rendered into a body-level portal, like the printed prescription it can
 * open over, and kept off paper.
 */
export default function SendMessageSheet({ visitId, start, onDismiss }: SendMessageSheetProps) {
  const [templateKey, setTemplateKey] = useState<string>(start?.templateKey ?? MESSAGE_TEMPLATES[0].key);
  // The text as edited for the selected template; null shows the template's own filled text.
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(
    start ? { key: start.templateKey, text: start.body } : null,
  );
  const [channel, setChannel] = useState<MessageChannel>(start?.channel ?? MessageChannel.WhatsApp);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const data = useLiveQuery<SendData | null>(async () => {
    const visit = await db.visits.get(visitId);
    if (!visit) {
      return null;
    }
    const [patient, practitioner, location, invoice, overrides, sessionLabel] = await Promise.all([
      db.patients.get(visit.patient_id),
      db.practitioners.get(visit.practitioner_id),
      db.locations.get(visit.location_id),
      db.invoices.where("visit_id").equals(visit.id).first(),
      db.message_templates.toArray(),
      carePlanSessionLabelForVisit(db, visit.id),
    ]);
    const organization = location ? await db.organizations.get(location.org_id) : undefined;
    return {
      patient,
      values: templateValuesForVisit({
        visit,
        patient,
        practitioner,
        organization,
        location,
        invoice,
        sessionLabel,
      }),
      overrides: new Map(overrides.map((override) => [override.key, override])),
    };
  }, [visitId]);

  if (!data) {
    return createPortal(
      <div className="print:hidden">
        <Sheet onDismiss={onDismiss}>
          <SheetHeader title={T.sendSheetTitle} onDismiss={onDismiss} />
          <SheetPanelBody>
            <p className="text-muted">{T.loadingLabel}</p>
          </SheetPanelBody>
        </Sheet>
      </div>,
      document.body,
    );
  }

  const text =
    edited?.key === templateKey
      ? edited.text
      : initialMessageText(templateKey, effectiveBody(templateKey, data.overrides.get(templateKey)), data.values);
  const warning = missingValuesWarning(text);
  const patient = data.patient;

  async function handleSend() {
    if (!patient) {
      setError(T.errorRecordMissing);
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      const { link } = await recordMessageAttempt(db, {
        patientId: patient.id,
        visitId,
        templateKey,
        channel,
        body: text,
      });
      if (channel === MessageChannel.WhatsApp) {
        window.open(link, "_blank", "noopener");
      } else {
        window.location.href = link;
      }
      onDismiss();
    } catch (caught) {
      setError(sendErrorMessage(caught));
    } finally {
      setIsSending(false);
    }
  }

  return createPortal(
    <div className="print:hidden">
      <Sheet onDismiss={onDismiss}>
        <SheetHeader title={T.sendSheetTitle} onDismiss={onDismiss} />
        <SheetPanelBody>
          {patient && (
            <p className="text-[13px] font-semibold text-text">
              {T.sendRecipientPrefix} {patient.full_name}
              {patient.phone && (
                <>
                  {" · "}
                  <Ltr className="font-mono text-xs">{formatEgyptianPhoneForDisplay(patient.phone)}</Ltr>
                </>
              )}
            </p>
          )}
          <ToggleGroup
            variant="filter"
            label={T.sendTemplateLabel}
            value={templateKey}
            onChange={(key) => {
              setTemplateKey(key);
              setEdited(null);
              setError(null);
            }}
            options={MESSAGE_TEMPLATES.map((template) => ({
              value: template.key,
              label: template.name,
            }))}
          />
          <Field label={T.sendBodyLabel} id="send-message-body" hint={T.sendBodyHint}>
            <TextArea
              value={text}
              rows={8}
              onChange={(event) => setEdited({ key: templateKey, text: event.currentTarget.value })}
            />
          </Field>
          {warning && (
            <p
              role="status"
              className="rounded-control bg-warning-wash px-3 py-2 text-[12.5px] font-semibold text-warning"
            >
              {warning}
            </p>
          )}
          {/* `.msg-ch-toggle` */}
          <ToggleGroup
            variant="channel"
            label={T.sendChannelLabel}
            value={channel}
            onChange={setChannel}
            className="self-start"
            options={[
              {
                value: MessageChannel.WhatsApp,
                label: (
                  <>
                    <span aria-hidden="true" className="text-whatsapp">
                      ●
                    </span>{" "}
                    {T.channelWhatsApp}
                  </>
                ),
              },
              { value: MessageChannel.Sms, label: T.channelSms },
            ]}
          />
          {error && (
            <p role="alert" className="text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          )}
        </SheetPanelBody>
        <SheetPanelFoot>
          <Button variant="primary" className="flex-1" disabled={isSending} onClick={() => void handleSend()}>
            {channel === MessageChannel.WhatsApp ? T.openWhatsApp : T.openSms}
          </Button>
        </SheetPanelFoot>
      </Sheet>
    </div>,
    document.body,
  );
}
