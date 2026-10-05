import {
  cloneElement,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type TextareaHTMLAttributes,
} from "react";

export type TextInputVariant = "default" | "centered" | "mono" | "amount";

/** The subset of DOM attributes Field needs to wire onto whichever control it wraps. */
interface FieldControlProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export interface FieldProps {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  children: ReactElement<FieldControlProps>;
}

/**
 * Prototype source: `.field`, `.field label`, `.field .hint`
 * (docs/reference/clintra-prototype.html). Lays out a label associated with
 * its control via htmlFor/id, and an optional hint or error line below it.
 * The error message and its aria-invalid/aria-describedby wiring onto the
 * control are not in the prototype — existing forms need validation, so
 * this is an addition, styled in the `danger` tokens.
 *
 * Field clones its single child (TextInput or TextArea) to inject `id` and,
 * when `error` is set, `aria-invalid` plus `aria-describedby` pointing at
 * the error text; otherwise `aria-describedby` points at the hint, if any.
 */
export default function Field({ label, id, hint, error, children }: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-[11px] font-bold tracking-[0.02em] text-muted">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? (
        <span id={errorId} className="mt-0.5 text-[10.5px] text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="mt-0.5 text-[10.5px] text-faint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

// Shared across TextInput and TextArea: the `.field .in` box itself, its
// focus ring (`.field .in:focus`), and the disabled treatment Button.tsx
// already establishes for this component family.
// Note: no font-size, border-color, background, text color or font-weight
// here, even though `.field .in` has its own (15px/border-rule/bg-field/
// text-text/600) — those live in VARIANT_CLASSES and controlStateClasses
// below instead, so exactly one class ever sets each of those properties.
// Every one of them is set by more than one of these blocks at equal
// specificity, and Tailwind's cascade goes by generated-sheet order, not by
// position in the className string (see Button.tsx's BASE comment) —
// combining a "default" utility with a conditionally-added "amount"/
// "filled" one here would leave the winner up to that order instead of to
// this component's own variant/state.
const IN_BASE =
  "w-full rounded-control border-[1.5px] px-[13px] py-2.5 font-[inherit] transition-colors duration-150 " +
  "placeholder:font-normal placeholder:text-faint " +
  "focus:outline-none focus:border-green focus:bg-card focus:shadow-[0_0_0_3.5px_color-mix(in_srgb,var(--color-green)_16%,transparent)] " +
  "disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50";

// `.field .in`'s own resting border/background/text color, and
// `.field .in.filled`'s (card background, green border and text). Weight is
// kept separate (WEIGHT_CLASSES below) for the same reason color is split
// from IN_BASE: screen 6's amount field is both filled AND wears its own
// 800 weight via an inline style that beats `.filled`'s 700 by CSS
// specificity — VARIANT_WEIGHT_OVERRIDE reproduces that same precedence
// deliberately, in JS, rather than leaving a filled amount field's weight
// to class order.
const COLOR_CLASSES = {
  default: "border-rule bg-field text-text",
  filled: "border-green bg-card text-green",
  invalid: "border-danger-line bg-danger-wash text-danger",
} as const;

const WEIGHT_CLASSES = {
  default: "font-semibold",
  filled: "font-bold",
} as const;

type ControlState = keyof typeof COLOR_CLASSES;

// Variants the prototype actually shows on a `.field .in`, each reproduced
// from its own inline style rather than invented:
// - centered: no further source beyond text-align:center.
// - mono: the device-activation screen's two mono fields (كود العيادة,
//   رقم الموبايل) — 16px/15px, letter-spacing .05em/.03em. Folded into one
//   16px / tracking-wider (.05em) definition rather than two near-duplicate
//   variants, since both read as the same "device code" style.
// - amount: screen 6's filled payment amount — 24px/centered/tabular. Its
//   800 weight is in VARIANT_WEIGHT_OVERRIDE, not here (see above).
const VARIANT_CLASSES: Record<TextInputVariant, string> = {
  default: "text-[15px]",
  centered: "text-center text-[15px]",
  mono: "text-center font-mono text-base tracking-wider tabular-nums",
  amount: "text-center text-2xl tracking-[-0.02em] tabular-nums",
};

const VARIANT_WEIGHT_OVERRIDE: Partial<Record<TextInputVariant, string>> = {
  amount: "font-extrabold",
};

function controlStateClasses(state: ControlState, variant: TextInputVariant): string {
  const weight = VARIANT_WEIGHT_OVERRIDE[variant] ?? WEIGHT_CLASSES[state === "filled" ? "filled" : "default"];
  return `${COLOR_CLASSES[state]} ${weight}`;
}

type TextInputOwnProps = {
  /** Overrides the automatic filled detection below. */
  filled?: boolean;
  variant?: TextInputVariant;
};

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & TextInputOwnProps;

/** `.field .in` on an `<input>` — see Field's doc comment for the shared styling and variants. */
export function TextInput({
  filled,
  variant = "default",
  className,
  value,
  defaultValue,
  onChange,
  "aria-invalid": ariaInvalid,
  ...rest
}: TextInputProps) {
  const isControlled = value !== undefined;
  const [uncontrolledFilled, setUncontrolledFilled] = useState(() => Boolean(defaultValue));
  const isInvalid = ariaInvalid === true || ariaInvalid === "true";
  const isFilled = filled ?? (isControlled ? Boolean(value) : uncontrolledFilled);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!isControlled) {
      setUncontrolledFilled(event.currentTarget.value.length > 0);
    }
    onChange?.(event);
  }

  // Invalid always wins over filled when both would apply (e.g. a filled
  // field that fails validation) — decided in JS rather than left to
  // Tailwind's generated-sheet order, which doesn't track source position
  // within a single className string (see Button.tsx's BASE comment).
  const state: ControlState = isInvalid ? "invalid" : isFilled ? "filled" : "default";

  const classes = [IN_BASE, VARIANT_CLASSES[variant], controlStateClasses(state, variant), className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      aria-invalid={ariaInvalid}
      className={classes}
      {...rest}
    />
  );
}

type TextAreaOwnProps = {
  filled?: boolean;
};

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & TextAreaOwnProps;

/** `.field textarea.in` — resizes vertically only, min-height 80px, 1.7 line-height. */
export function TextArea({
  filled,
  className,
  value,
  defaultValue,
  onChange,
  "aria-invalid": ariaInvalid,
  ...rest
}: TextAreaProps) {
  const isControlled = value !== undefined;
  const [uncontrolledFilled, setUncontrolledFilled] = useState(() => Boolean(defaultValue));
  const isInvalid = ariaInvalid === true || ariaInvalid === "true";
  const isFilled = filled ?? (isControlled ? Boolean(value) : uncontrolledFilled);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (!isControlled) {
      setUncontrolledFilled(event.currentTarget.value.length > 0);
    }
    onChange?.(event);
  }

  const state: ControlState = isInvalid ? "invalid" : isFilled ? "filled" : "default";

  const classes = [
    IN_BASE,
    "min-h-20 resize-y text-[15px] leading-[1.7]",
    controlStateClasses(state, "default"),
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      aria-invalid={ariaInvalid}
      className={classes}
      {...rest}
    />
  );
}
