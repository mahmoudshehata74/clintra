import LtrRuns from "../../components/LtrRuns";
import type { RxDoseLine } from "./workspace";
import { visitWorkspaceStrings as T } from "./strings";

/**
 * A drug's dose line as the prototype writes it (`.rx-item .dose`): the
 * instructions, then "· لمدة" and the duration in bold — shared by the visit
 * workspace and the printed prescription, which pass their own bold look.
 * Every Latin or digit run ("100mg", "1/2", "7") is its own left-to-right
 * isolate (LtrRuns).
 */
export default function RxDoseText({ line, strongClassName }: { line: RxDoseLine; strongClassName: string }) {
  return (
    <>
      <LtrRuns text={line.instructions} />
      {line.duration && (
        <>
          {" · "}
          {T.rxDurationPrefix}{" "}
          <b className={strongClassName}>
            <LtrRuns text={line.duration} />
          </b>
        </>
      )}
    </>
  );
}
