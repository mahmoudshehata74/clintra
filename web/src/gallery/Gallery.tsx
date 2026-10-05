import BadgeSection from "./sections/BadgeSection";
import ButtonsSection from "./sections/ButtonsSection";
import CardSection from "./sections/CardSection";
import FieldSection from "./sections/FieldSection";
import ToggleChipSection from "./sections/ToggleChipSection";
import { galleryStrings } from "./strings";

/**
 * The component gallery (?gallery=1) — a dev-only surface for reviewing
 * shared components in isolation, outside the real app's database,
 * registration, and lock-screen boot sequence (see main.tsx, which renders
 * this instead of App for the whole session rather than layering it on).
 * Each future shared component adds its own section below, in its own file
 * under ./sections.
 */
export default function Gallery() {
  return (
    <div className="min-h-screen bg-paper px-6 py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <h1 className="text-2xl font-bold text-text">{galleryStrings.pageTitle}</h1>
        <ButtonsSection />
        <FieldSection />
        <CardSection />
        <BadgeSection />
        <ToggleChipSection />
      </div>
    </div>
  );
}
