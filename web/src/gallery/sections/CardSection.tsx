import Button from "../../components/ui/Button";
import Card, { CardBody, CardFooter, CardHead } from "../../components/ui/Card";
import { cardGalleryStrings, galleryStrings } from "../strings";

/** Card, CardHead, CardBody and CardFooter — screen 3's "مواعيد اليوم" shell, plus a plain body-only card. */
export default function CardSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.cardsSectionTitle}</h2>

      <Card>
        <CardHead
          badge={cardGalleryStrings.dayCardBadge}
          title={cardGalleryStrings.dayCardTitle}
          subtitle={cardGalleryStrings.dayCardSubtitle}
          action={
            <Button variant="onDark" size="sm">
              {cardGalleryStrings.dayCardTrailingAction}
            </Button>
          }
        />
        <CardBody>
          <p className="text-sm text-muted">{cardGalleryStrings.dayCardPlaceholderBody}</p>
        </CardBody>
        <CardFooter
          count={
            <>
              <b>{cardGalleryStrings.dayCardCountAppointments}</b> {cardGalleryStrings.dayCardCountAppointmentsLabel} ·{" "}
              <b>{cardGalleryStrings.dayCardCountBooked}</b> {cardGalleryStrings.dayCardCountBookedLabel} ·{" "}
              <b>{cardGalleryStrings.dayCardCountFree}</b> {cardGalleryStrings.dayCardCountFreeLabel}
            </>
          }
        >
          <Button variant="primary" size="sm">
            {cardGalleryStrings.dayCardPrimaryAction}
          </Button>
          <Button variant="secondary" size="sm">
            {cardGalleryStrings.dayCardSecondaryAction}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardBody>
          <p className="text-sm text-muted">{cardGalleryStrings.plainCardBody}</p>
        </CardBody>
      </Card>
    </section>
  );
}
