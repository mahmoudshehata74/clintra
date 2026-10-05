import { useEffect, useRef, useState } from "react";
import { db } from "../db/database";
import { useLiveQuery } from "../db/useLiveQuery";
import type { Membership, User } from "../db/types";
import Badge from "../components/ui/Badge";
import { formatActorLabel } from "../screens/day/actorLabel";
import { authStrings } from "./authStrings";
import { verifyPin } from "./pinHash";
import { clearAttempts, getLockRemainingMs, registerFailedAttempt } from "./pinRateLimit";
import { setActiveMembershipId } from "./session";

const PIN_LENGTH = 4;
const PAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface LockScreenProps {
  /** The last person who was logged in — re-lock shows their PIN pad directly; a fresh launch (undefined) shows the picker. */
  defaultMembershipId?: string;
}

interface StaffOption {
  membership: Membership;
  user: User | undefined;
}

/**
 * The full-viewport lock overlay (reference screen 2). One screen, two states:
 * a membership picker when nobody is chosen yet ("دخول العيادة"), then the PIN
 * pad for the chosen person ("دخول <name>"). Opaque by design — per
 * docs/auth-plan.md the underlying UI (including any open sheet) stays mounted
 * but must never be visible or interactable behind this, and is restored intact
 * on a correct PIN.
 */
export default function LockScreen({ defaultMembershipId }: LockScreenProps) {
  const staff =
    useLiveQuery<StaffOption[]>(async () => {
      const memberships = (await db.memberships.toArray()).filter((membership) => membership.is_active);
      const users = await db.users.bulkGet(memberships.map((membership) => membership.user_id));
      const usersById = new Map(users.filter((user): user is User => user != null).map((user) => [user.id, user]));
      return memberships.map((membership) => ({ membership, user: usersById.get(membership.user_id) }));
    }, []) ?? [];

  const [pickedId, setPickedId] = useState<string | undefined>(defaultMembershipId);
  const [entered, setEntered] = useState("");
  const [wrong, setWrong] = useState(false);
  // Bumped once a second while locked out to re-read the countdown; its value is
  // unused beyond forcing a re-render (the clock is read inside pinRateLimit).
  const [, setTick] = useState(0);
  // The keydown handler is registered once per pickedId/lock change; it reads
  // the live entered value through this ref rather than a stale closure.
  const enteredRef = useRef("");

  const picked = pickedId ? staff.find((option) => option.membership.id === pickedId) : undefined;
  const lockRemainingMs = pickedId ? getLockRemainingMs(pickedId) : 0;
  const isLockedOut = lockRemainingMs > 0;

  function setEnteredValue(next: string): void {
    enteredRef.current = next;
    setEntered(next);
  }

  // Verification happens in the entry handler (not an effect): the ~250ms
  // Argon2id hash is synchronous, but by then the fourth dot has already
  // committed, and keeping it out of an effect avoids cascading-render lint and
  // any dependency on the event-loop clock (which matters under test control).
  function verify(candidate: string): void {
    if (!pickedId) {
      return;
    }
    const membership = picked?.membership;
    const ok =
      membership?.pin_salt != null && verifyPin(candidate, membership.pin_salt, membership.pin_hash);
    if (ok) {
      clearAttempts(pickedId);
      setActiveMembershipId(pickedId);
      return;
    }
    registerFailedAttempt(pickedId);
    setEnteredValue("");
    setWrong(true);
  }

  function pressDigit(digit: string): void {
    if (isLockedOut) {
      return;
    }
    const current = enteredRef.current;
    if (current.length >= PIN_LENGTH) {
      return;
    }
    setWrong(false);
    const next = current + digit;
    setEnteredValue(next);
    if (next.length === PIN_LENGTH) {
      verify(next);
    }
  }

  function pressDelete(): void {
    setWrong(false);
    setEnteredValue(enteredRef.current.slice(0, -1));
  }

  function choose(membershipId: string | undefined): void {
    setPickedId(membershipId);
    setEnteredValue("");
    setWrong(false);
  }

  // Tick while locked out so the countdown updates and the pad re-enables.
  useEffect(() => {
    if (!isLockedOut) {
      return;
    }
    const interval = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(interval);
  }, [isLockedOut]);

  // Hardware number keys also drive the pad (accessibility and speed).
  useEffect(() => {
    if (!pickedId) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key >= "0" && event.key <= "9") {
        pressDigit(event.key);
      } else if (event.key === "Backspace") {
        pressDelete();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handler reads live refs/state; only pickedId and isLockedOut gate registration.
  }, [pickedId, isLockedOut]);

  // Wrong-PIN and lockout are both states the prototype's own #s1 never
  // draws (it shows one static mid-entry frame). Both read as an alert on
  // the ink surface: plain danger text here fails 4.5:1 against ink
  // (#A32A21 on #0B211D measures ~2.3:1), so the message renders inside a
  // solid danger Badge pill instead — white text on the solid danger fill
  // measures ~7.2:1, comfortably over the bar, while the pill still reads
  // as the same danger-toned alert the flat text would have been.
  const alertMessage = isLockedOut
    ? `${authStrings.lockLockedOutPrefix} ${Math.ceil(lockRemainingMs / 1000)} ${authStrings.lockSecondsSuffix}`
    : wrong
      ? authStrings.lockWrongPin
      : null;

  const padKeyClassName =
    "flex min-h-12 items-center justify-center rounded-card border border-white/[0.13] bg-white/[0.06] font-semibold text-on-dark " +
    "transition-colors duration-150 hover:bg-white/[0.14] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 focus-visible:ring-offset-ink " +
    "disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_100%)] px-6 text-center"
      role="dialog"
      aria-modal="true"
      aria-label={authStrings.lockOverlayAria}
    >
      <p className="text-[22px] font-bold tracking-[-0.02em] text-white">
        Clin<span className="text-copper-2">tra</span>
      </p>

      {!picked ? (
        // Not drawn by the prototype (#s1 shows only the PIN state): same
        // ink surface and brand, each membership as a full-width on-dark
        // row rather than Button's onDark variant, which has no form sized
        // for a 48px-tall, full-width list item.
        <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
          <p className="mb-2 text-sm font-semibold tracking-[0.02em] text-on-dark">{authStrings.lockClinicPrompt}</p>
          {staff.map(({ membership, user }) => (
            <button
              key={membership.id}
              type="button"
              onClick={() => choose(membership.id)}
              className="min-h-12 w-full rounded-card border border-white/[0.16] bg-white/[0.09] px-4 py-3 text-start text-sm font-semibold text-on-dark transition-colors duration-150 hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              {formatActorLabel(membership, user)}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-8 flex w-full max-w-[300px] flex-col items-center">
          <p className="mt-[6px] text-xs tracking-[0.02em] text-on-dark-dim">
            {authStrings.lockEnterPrefix} {formatActorLabel(picked.membership, picked.user)}
          </p>
          <p className="mt-[22px] text-sm font-semibold tracking-[0.02em] text-on-dark">{authStrings.lockPinTitle}</p>

          <div className="mt-[14px] flex justify-center gap-[10px]">
            {Array.from({ length: PIN_LENGTH }).map((_, index) => {
              const filled = index < entered.length;
              return (
                <span
                  key={index}
                  aria-hidden="true"
                  data-filled={filled}
                  className={
                    filled
                      ? "h-3 w-3 rounded-full bg-copper shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-copper)_25%,transparent)]"
                      : "h-3 w-3 rounded-full bg-white/[0.15]"
                  }
                />
              );
            })}
          </div>
          {/* Screen-reader progress, per docs/auth-plan.md Layer 2 Q5 ("2 of 4
              entered"); the data-filled attributes above let a test assert
              the same progress without relying on dot colour. */}
          <span className="sr-only" role="status" aria-live="polite">
            {entered.length} {authStrings.lockDigitsProgressOf} {PIN_LENGTH} {authStrings.lockDigitsProgressSuffix}
          </span>

          <div className="mt-3 flex min-h-[26px] items-center justify-center">
            {alertMessage ? (
              <Badge appearance="solid" tone="danger" shape="pill">
                {alertMessage}
              </Badge>
            ) : null}
          </div>

          <div className="mt-[22px] grid w-full max-w-[240px] grid-cols-3 gap-2">
            {PAD_DIGITS.map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={isLockedOut}
                onClick={() => pressDigit(digit)}
                className={`${padKeyClassName} text-xl tabular-nums tracking-[-0.02em]`}
              >
                {digit}
              </button>
            ))}
            <span aria-hidden="true" />
            <button
              type="button"
              disabled={isLockedOut}
              onClick={() => pressDigit("0")}
              className={`${padKeyClassName} text-xl tabular-nums tracking-[-0.02em]`}
            >
              0
            </button>
            <button
              type="button"
              onClick={pressDelete}
              aria-label={authStrings.lockDeleteAria}
              className={`${padKeyClassName} text-sm`}
            >
              {authStrings.lockDeleteLabel}
            </button>
          </div>

          {staff.length > 1 && (
            <button
              type="button"
              onClick={() => choose(undefined)}
              className="mt-6 text-xs font-semibold text-on-dark-dim transition-colors duration-150 hover:text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              {authStrings.lockSwitchUser}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
