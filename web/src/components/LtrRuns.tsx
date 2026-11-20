import { splitLtrRuns } from "../domain/ltrRuns";
import Ltr from "./Ltr";

/**
 * Free text with every Latin or digit run in its own left-to-right isolate
 * (Ltr), so a dose like "100mg" or "1/2" inside Arabic never reorders with
 * its neighbours; the Arabic between them is left as it is.
 */
export default function LtrRuns({ text }: { text: string }) {
  return (
    <>
      {splitLtrRuns(text).map((part, index) => (part.ltr ? <Ltr key={index}>{part.text}</Ltr> : part.text))}
    </>
  );
}
