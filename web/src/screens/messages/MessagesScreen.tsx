import { useState } from "react";
import PageMain from "../../components/PageMain";
import Ltr from "../../components/Ltr";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Field, { TextArea } from "../../components/ui/Field";
import { db } from "../../db/database";
import { markMessageSent, resetTemplate, saveTemplateBody, TemplateError, unmarkMessageSent } from "../../db/messages";
import { MessageChannel, type Membership, type Message, type MessageTemplate } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { effectiveBody, MESSAGE_TEMPLATES, type MessageTemplateDefinition } from "../../domain/messageTemplates";
import { Role } from "../../domain/role";
import {
  messageRecipientLine,
  messageSnippet,
  PLACEHOLDER_LABELS,
  PLACEHOLDERS,
  placeholderToken,
  recentMessages,
  segmentTemplateBody,
  templateBadgeTone,
  templateChipLabel,
  templateIcon,
} from "./messagesModel";
import SendMessageSheet from "./SendMessageSheet";
import { messagesStrings as T } from "./strings";
import { suggestedMessages, type SuggestedMessage } from "./suggestedMessages";

interface MessagesScreenProps {
  /** The membership whose page this is: its role decides who edits, its organization and locations which messages show. */
  membership: Membership;
}

interface RecentRow {
  message: Message;
  patientName: string | undefined;
}

interface MessagesData {
  overrides: Map<string, MessageTemplate>;
  recent: RecentRow[];
  suggested: SuggestedMessage[];
}

/**
 * The messages page (reference screen 19, `.msg-layout`): `.msg-side` lists
 * the six templates in their defined order (`.msg-tpl`, `.icn`, `.n`, `.d`,
 * `.badge` / `.badge.auto` / `.badge.manual`); `.msg-main` shows the selected
 * one in `.msg-preview` (`.h`, `.t`, `.ch`, `.msg-body` with `.var` chips),
 * then "مقترح النهارده" (SuggestedMessages, below — no prototype
 * counterpart), then `.msg-sent`'s recent messages (`.msg-item`, `.icn.wa` / `.icn.sms`,
 * `.to`, `.snip`, `.st` / `.st.pending`).
 *
 * Owner decisions over the prototype: the channel toggle is not on this page
 * (templates are channel-agnostic; it lives in the send sheet); the owner
 * edits a template's raw body in place, every other role reads it; custom
 * has no body to edit. Below 768px `.msg-side` becomes a horizontal row of
 * template chips above `.msg-main`.
 */
export default function MessagesScreen({ membership }: MessagesScreenProps) {
  const [selectedKey, setSelectedKey] = useState<string>(MESSAGE_TEMPLATES[0].key);
  const [sending, setSending] = useState<SuggestedMessage | null>(null);
  const isOwner = membership.role === Role.Owner;

  const data = useLiveQuery<MessagesData>(async () => {
    const [overrides, messages, links, visits, allPatients, invoices, carePlanItems] = await Promise.all([
      db.message_templates.toArray(),
      db.messages.toArray(),
      db.membership_locations.toArray(),
      db.visits.toArray(),
      db.patients.toArray(),
      db.invoices.toArray(),
      db.care_plan_items.toArray(),
    ]);
    const listedLocationIds = new Set(
      links.filter((link) => link.membership_id === membership.id).map((link) => link.location_id),
    );
    const access = { membership, listedLocationIds };
    const recent = recentMessages(messages, access);
    const patientsById = new Map(allPatients.map((patient) => [patient.id, patient]));
    return {
      overrides: new Map(overrides.map((override) => [override.key, override])),
      recent: recent.map((message) => ({ message, patientName: patientsById.get(message.patient_id)?.full_name })),
      suggested: suggestedMessages({
        visits,
        patients: allPatients,
        invoices,
        carePlanItems,
        messages,
        access,
        now: new Date(),
      }),
    };
  }, [membership.id, membership.org_id, membership.location_scope]);

  const selected = MESSAGE_TEMPLATES.find((template) => template.key === selectedKey) ?? MESSAGE_TEMPLATES[0];

  return (
    <PageMain className="flex flex-col gap-3.5 pt-6 pb-16 print:hidden">
      {!data ? (
        <p className="text-muted">{T.loadingLabel}</p>
      ) : (
        <Card>
          {/* `.msg-layout` */}
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
            <TemplateList selectedKey={selected.key} onSelect={setSelectedKey} />
            {/* `.msg-main` */}
            <div className="min-w-0 p-5">
              <TemplatePreview
                key={selected.key}
                definition={selected}
                override={data.overrides.get(selected.key)}
                isOwner={isOwner}
              />
              <SuggestedMessages rows={data.suggested} onSend={setSending} />
              <RecentMessages rows={data.recent} />
            </div>
          </div>
        </Card>
      )}
      {sending && (
        <SendMessageSheet
          key={sending.key}
          visitId={sending.visitId}
          start={{ templateKey: sending.templateKey }}
          onDismiss={() => setSending(null)}
        />
      )}
    </PageMain>
  );
}

// `.msg-tpl` — on desktop a full-width row with a 3px inline-start edge
// (copper when `.active`); below md a rounded chip in a horizontal scroller,
// showing only `.icn` and `.n`. One class per property per state.
const TEMPLATE_BASE =
  "flex shrink-0 cursor-pointer items-center gap-2 rounded-control border-s-[3px] px-3 py-2 text-start ring-1 transition-colors duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green " +
  "md:w-full md:gap-[10px] md:rounded-none md:px-4 md:py-2.5 md:ring-0 md:hover:bg-card";
const TEMPLATE_INACTIVE = "border-s-transparent bg-card ring-rule md:bg-transparent";
const TEMPLATE_ACTIVE = "border-s-copper bg-card ring-copper-line";

function TemplateList({ selectedKey, onSelect }: { selectedKey: string; onSelect: (key: string) => void }) {
  return (
    // `.msg-side`
    <nav
      aria-label={T.templatesHeading}
      className="min-w-0 border-b border-rule bg-field py-3 md:border-b-0 md:border-e"
    >
      {/* `.msg-side-h` */}
      <h2 className="px-4 pb-2.5 text-[11px] font-bold tracking-[0.05em] text-muted">{T.templatesHeading}</h2>
      <div className="flex gap-2 overflow-x-auto px-4 pb-1 md:flex-col md:gap-0 md:overflow-visible md:px-0 md:pb-0">
        {MESSAGE_TEMPLATES.map((template) => {
          const isActive = template.key === selectedKey;
          return (
            <button
              key={template.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(template.key)}
              className={`${TEMPLATE_BASE} ${isActive ? TEMPLATE_ACTIVE : TEMPLATE_INACTIVE}`}
            >
              {/* `.icn` */}
              <span
                aria-hidden="true"
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-control border border-copper-line bg-copper-wash text-[13px] font-bold text-copper"
              >
                {templateIcon(template.key)}
              </span>
              {/* `.body` */}
              <span className="min-w-0 md:flex-1">
                <span className="block whitespace-nowrap text-[12.5px] font-semibold text-text">{template.name}</span>
                <span className="mt-px hidden truncate text-[10.5px] text-muted md:block">{template.description}</span>
              </span>
              <Badge appearance="solid" tone={templateBadgeTone(template)} className="hidden md:inline">
                {template.kind}
              </Badge>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** `.msg-body`: the effective body with each known placeholder as a `.var` chip. */
function TemplateBody({ body }: { body: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-control border border-rule bg-card px-3.5 py-3 text-[13px] leading-[1.85] text-text">
      {segmentTemplateBody(body).map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span key={index} className="rounded-chip bg-copper-wash px-1.5 py-px text-[11.5px] font-semibold text-copper">
            {segment.label}
          </span>
        ),
      )}
    </div>
  );
}

function templateErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case TemplateError.NotOwner:
      return T.errorNotOwner;
    case TemplateError.BodyRequired:
      return T.errorBodyRequired;
    case TemplateError.BodyTooLong:
      return T.errorBodyTooLong;
    default:
      return T.errorSaveFailed;
  }
}

interface TemplatePreviewProps {
  definition: MessageTemplateDefinition;
  override: MessageTemplate | undefined;
  isOwner: boolean;
}

/** `.msg-preview` — and, for the owner, the raw-body editor that replaces its `.msg-body`. */
function TemplatePreview({ definition, override, isOwner }: TemplatePreviewProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const body = effectiveBody(definition.key, override);
  const chip = templateChipLabel(definition, override !== undefined, isOwner);
  const canEdit = isOwner && definition.editable;
  const isEditing = draft !== null;

  function startEditing() {
    setDraft(body);
    setCaret(null);
    setError(null);
  }

  function insert(token: string) {
    const current = draft ?? "";
    const at = caret ?? current.length;
    setDraft(current.slice(0, at) + token + current.slice(at));
    setCaret(at + token.length);
  }

  async function run(write: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await write();
      setDraft(null);
    } catch (caught) {
      setError(templateErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-label={`${T.previewPrefix} ${definition.name}`} className="mb-3.5 rounded-card border border-rule bg-field px-4 py-3.5">
      {/* `.h` */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[12.5px] font-bold text-text">
          {T.previewPrefix} {definition.name}
        </h2>
        {chip && (
          <span className="ms-auto rounded-chip border border-rule bg-card px-[9px] py-[3px] text-[10.5px] font-semibold text-muted">
            {chip}
          </span>
        )}
      </div>

      {!definition.editable ? (
        <p className="text-[12.5px] text-muted">{T.customBodyNote}</p>
      ) : isEditing ? (
        <div className="flex flex-col gap-2.5">
          <Field label={T.editorLabel} id="template-body-editor" error={error ?? undefined}>
            <TextArea
              value={draft}
              rows={8}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setCaret(event.currentTarget.selectionStart);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            />
          </Field>
          <div role="group" aria-label={T.insertLabel} className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((placeholder) => (
              <Button key={placeholder} variant="secondary" size="sm" onClick={() => insert(placeholderToken(placeholder))}>
                ＋ {PLACEHOLDER_LABELS[placeholder]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={isSaving} onClick={() => void run(() => saveTemplateBody(db, definition.key, draft))}>
              {T.saveAction}
            </Button>
            <Button variant="muted" disabled={isSaving} onClick={() => setDraft(null)}>
              {T.cancelAction}
            </Button>
            {override && (
              <Button variant="danger" disabled={isSaving} onClick={() => void run(() => resetTemplate(db, definition.key))}>
                {T.resetAction}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <TemplateBody body={body} />
          {canEdit && (
            <div className="mt-2.5 flex">
              <Button variant="secondary" size="sm" onClick={startEditing}>
                {T.editAction}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// `.msg-item .st` (sent) and `.st.pending` (opened, not yet marked) — a
// button here, since tapping it marks or unmarks the message by hand.
const STATUS_BASE =
  "cursor-pointer whitespace-nowrap rounded-chip px-[7px] py-0.5 text-[10px] font-bold " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green";
const STATUS_SENT = "bg-[color-mix(in_srgb,var(--color-eligible)_15%,transparent)] text-eligible";
const STATUS_PENDING = "bg-warning-wash text-warning";

// `.msg-item .icn` with `.wa` / `.sms`.
const CHANNEL_ICON_BASE = "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-chip text-[11px] font-bold";
const CHANNEL_ICON_LOOK: Record<MessageChannel, string> = {
  [MessageChannel.WhatsApp]: "bg-[color-mix(in_srgb,var(--color-whatsapp)_12%,transparent)] text-whatsapp",
  [MessageChannel.Sms]: "bg-green-wash text-green",
};

function RecentMessages({ rows }: { rows: RecentRow[] }) {
  return (
    // `.msg-sent`
    <section aria-labelledby="recent-messages-heading" className="mt-4">
      <h2 id="recent-messages-heading" className="mb-2 px-1 text-[11px] font-bold tracking-[0.05em] text-muted">
        {T.recentHeading}
      </h2>
      {rows.length === 0 ? (
        <p className="px-1 text-[12.5px] text-faint">{T.recentEmpty}</p>
      ) : (
        <ul>
          {rows.map(({ message, patientName }) => {
            const isSent = message.marked_sent_at !== null;
            const [name, phone] = splitRecipient(patientName, message.phone);
            return (
              <li
                key={message.id}
                className="mb-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-control border border-rule bg-card px-3 py-2.5"
              >
                <span aria-hidden="true" className={`${CHANNEL_ICON_BASE} ${CHANNEL_ICON_LOOK[message.channel]}`}>
                  {message.channel === MessageChannel.WhatsApp ? T.channelWhatsAppShort : T.channelSmsShort}
                </span>
                <div className="min-w-0">
                  {/* `.to` */}
                  <div className="text-xs font-semibold text-text">
                    {name}
                    <Ltr>{phone}</Ltr>
                  </div>
                  {/* `.snip` */}
                  <div className="mt-px truncate text-[10.5px] text-muted">{messageSnippet(message.body)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void (isSent ? unmarkMessageSent(db, message.id) : markMessageSent(db, message.id))}
                  className={`${STATUS_BASE} ${isSent ? STATUS_SENT : STATUS_PENDING}`}
                >
                  {isSent ? T.statusSent : T.statusOpened}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * "مقترح النهارده", above `.msg-sent`: the patients who should get a
 * message today (suggestedMessages), with a count badge. Each row reads the
 * patient's name, the reason, and "ابعت", which opens SendMessageSheet on
 * that visit with the row's template preselected; a patient with no usable
 * number reads a muted "مفيش رقم" instead of the button. No prototype
 * counterpart: it wears `.msg-item`'s row look, tokens and shared components
 * only.
 */
function SuggestedMessages({ rows, onSend }: { rows: SuggestedMessage[]; onSend: (row: SuggestedMessage) => void }) {
  return (
    <section aria-labelledby="suggested-messages-heading" className="mt-4">
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 id="suggested-messages-heading" className="text-[11px] font-bold tracking-[0.05em] text-muted">
          {T.suggestedHeading}
        </h2>
        <Badge appearance="soft" tone="copper" className="tabular-nums">
          {rows.length}
        </Badge>
      </div>
      {rows.length === 0 ? (
        <p className="px-1 text-[12.5px] text-faint">{T.suggestedEmpty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.key}
              className="mb-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-control border border-rule bg-card px-3 py-2.5"
            >
              <span aria-hidden="true" className={`${CHANNEL_ICON_BASE} bg-copper-wash text-copper`}>
                {templateIcon(row.templateKey)}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-text">{row.patientName}</div>
                <div className="mt-px truncate text-[10.5px] text-muted">{row.reason}</div>
              </div>
              {row.hasPhone ? (
                <Button variant="secondary" size="sm" onClick={() => onSend(row)}>
                  {T.suggestedSendAction}
                </Button>
              ) : (
                <span className="text-[11px] font-semibold text-faint">{T.suggestedNoPhone}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** messageRecipientLine's "name · " prefix and its phone, apart, so the phone renders as its own left-to-right run. */
function splitRecipient(patientName: string | undefined, phone: string): [string, string] {
  const line = messageRecipientLine(patientName, phone);
  const separator = line.lastIndexOf(" · ");
  return separator === -1 ? ["", line] : [line.slice(0, separator + 3), line.slice(separator + 3)];
}
