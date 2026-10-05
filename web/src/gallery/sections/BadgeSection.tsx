import type { ReactNode } from "react";
import Badge from "../../components/ui/Badge";
import { badgeGalleryStrings, galleryStrings } from "../strings";

function Row({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-muted">{heading}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** One row per prototype source class — see strings.ts's badgeGalleryStrings doc comment. */
export default function BadgeSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.badgesSectionTitle}</h2>

      <div className="flex flex-col gap-6">
        <Row heading={badgeGalleryStrings.waitingHeading}>
          <Badge appearance="soft" tone="green">
            {badgeGalleryStrings.waitingHeading}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.longestWaitHeading}>
          <Badge appearance="soft" tone="warning">
            {badgeGalleryStrings.longestWaitLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.invoicePartialHeading}>
          <Badge appearance="soft" tone="warning">
            {badgeGalleryStrings.invoicePartialLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.prescriptionCountHeading}>
          <Badge appearance="soft" tone="copper">
            {badgeGalleryStrings.prescriptionCountLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.slotModeHeading}>
          <Badge appearance="soft" tone="neutral">
            {badgeGalleryStrings.slotModeLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.suggestedTemplateHeading}>
          <Badge appearance="solid" tone="copper" shape="chip">
            {badgeGalleryStrings.suggestedTemplateLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.optionalTemplateHeading}>
          <Badge appearance="solid" tone="eligible" shape="chip">
            {badgeGalleryStrings.optionalTemplateLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.manualTemplateHeading}>
          <Badge appearance="solid" tone="neutral" shape="chip">
            {badgeGalleryStrings.manualTemplateLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.statusArrivedHeading}>
          <Badge appearance="solid" tone="eligible" shape="pill">
            {badgeGalleryStrings.statusArrivedLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.statusInRoomHeading}>
          <Badge appearance="solid" tone="copper" shape="pill">
            {badgeGalleryStrings.statusInRoomLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.statusDoneHeading}>
          <Badge appearance="soft" tone="neutral" shape="pill">
            {badgeGalleryStrings.statusDoneLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.statusNoShowHeading}>
          <Badge appearance="solid" tone="danger" shape="pill">
            {badgeGalleryStrings.statusNoShowLabel}
          </Badge>
        </Row>

        <Row heading={badgeGalleryStrings.statusCancelledHeading}>
          <Badge appearance="dashed" tone="danger" shape="pill">
            {badgeGalleryStrings.statusCancelledLabel}
          </Badge>
        </Row>
      </div>

      <div className="rounded-panel bg-ink p-6">
        <Row heading={badgeGalleryStrings.onDarkHeading}>
          <Badge appearance="onDark">{badgeGalleryStrings.onDarkLabel}</Badge>
        </Row>
      </div>
    </section>
  );
}
