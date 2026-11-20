import { useState } from "react";
import text from "./identityStrings";
import Button from "../components/ui/Button";
import { TextInput, type TextInputProps } from "../components/ui/Field";

export default function PasswordInput({ initiallyVisible = false, ...props }: Omit<TextInputProps, "type"> & {
  initiallyVisible?: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TextInput {...props} className="min-w-0 flex-1" type={visible ? "text" : "password"} />
      <Button size="sm" variant="muted" type="button" aria-controls={props.id} disabled={props.disabled}
        onClick={() => setVisible(!visible)}>
        {visible ? text.hidePassword : text.showPassword}
      </Button>
    </div>
  );
}
