import { productPlaceholder } from "@achadinhos/creative";
import type { Offer } from "@/lib/mock";

export function ProductThumb({ offer, size = 44 }: { offer: Pick<Offer, "hue" | "label" | "title">; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={productPlaceholder(offer.hue, offer.label)}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-lg bg-sunken-2 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
