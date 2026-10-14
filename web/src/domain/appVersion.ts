import { version } from "../../package.json";
import { appBarStrings } from "../components/strings";

/** web/package.json's version — the one source for every place that names the build. */
export const APP_VERSION: string = version;

/** The printed pages' footer brand (`.print-foot`): "Clintra v{version}". */
export function printedBrand(): string {
  return `${appBarStrings.brandName} v${APP_VERSION}`;
}
