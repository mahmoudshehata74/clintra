import { useEffect, useRef, useState } from "react";
import { db } from "../db/database";
import { useLiveQuery } from "../db/useLiveQuery";
import type { Membership, User } from "../db/types";
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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper px-6"
      role="dialog"
      aria-modal="true"
      aria-label={authStrings.lockOverlayAria}
    >
      <h1 className="font-display text-3xl font-semibold text-green">Clintra</h1>

      {!picked ? (
        <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
          <p className="mb-2 text-center font-display text-lg font-medium text-ink">{authStrings.lockClinicPrompt}</p>
          {staff.map(({ membership, user }) => (
            <button
              key={membership.id}
              type="button"
              onClick={() => choose(membership.id)}
              className="rounded-[--radius-el] border border-line bg-paper px-4 py-3 text-center text-ink hover:bg-green-soft"
            >
              {formatActorLabel(membership, user)}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-8 flex w-full max-w-[300px] flex-col items-center">
          <p className="font-display text-lg font-medium text-ink">
            {authStrings.lockEnterPrefix} {picked.user?.full_name ?? ""}
          </p>

          <div className="mt-6 flex gap-4" aria-hidden="true">
            {Array.from({ length: PIN_LENGTH }).map((_, index) => (
              <span
                key={index}
                className={`h-3.5 w-3.5 rounded-full border ${
                  index < entered.length ? "border-green bg-green" : "border-line bg-transparent"
                } ${wrong ? "border-red" : ""}`}
              />
            ))}
          </div>

          <p className="mt-3 h-5 text-sm text-red">
            {isLockedOut
              ? `${authStrings.lockLockedOutPrefix} ${Math.ceil(lockRemainingMs / 1000)} ${authStrings.lockSecondsSuffix}`
              : wrong
                ? authStrings.lockWrongPin
                : ""}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {PAD_DIGITS.map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={isLockedOut}
                onClick={() => pressDigit(digit)}
                className="h-16 w-16 rounded-full border border-line bg-paper text-2xl text-ink disabled:opacity-40"
              >
                {digit}
              </button>
            ))}
            <span />
            <button
              type="button"
              disabled={isLockedOut}
              onClick={() => pressDigit("0")}
              className="h-16 w-16 rounded-full border border-line bg-paper text-2xl text-ink disabled:opacity-40"
            >
              0
            </button>
            <button
              type="button"
              onClick={pressDelete}
              aria-label={authStrings.lockDeleteAria}
              className="h-16 w-16 rounded-full text-2xl text-muted"
            >
              ←
            </button>
          </div>

          {staff.length > 1 && (
            <button type="button" onClick={() => choose(undefined)} className="mt-6 text-sm text-muted">
              {authStrings.lockSwitchUser}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
