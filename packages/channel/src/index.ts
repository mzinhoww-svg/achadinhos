export type { Channel, DeliveryResult, OutboundOffer, Slot } from "./types";
export { AFFILIATE_LINK_HOSTS, MAX_CREATIVE_PNG_BYTES, MAX_LINK_LENGTH, isAllowedLink } from "./limits";
export {
  createFileOutbox,
  OUTBOX_CODES,
  type FileOutboxOptions,
  type OutboxCode,
} from "./file-outbox";
export {
  renderDayIndex,
  renderOfferMarkdown,
  renderTextBlock,
  normalizeAffiliateLink,
  type DayIndexRow,
} from "./markdown";
export {
  MAX_TITLE_LENGTH,
  neutralizeExternal,
  sanitizeText,
  sanitizeTitle,
  stripLineSeparators,
  truncateCodepoints,
} from "./sanitize";
