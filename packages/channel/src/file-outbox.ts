import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import { join, resolve, sep } from "node:path";
import { AFFILIATE_LINK_HOSTS, MAX_CREATIVE_PNG_BYTES, isAllowedLink } from "./limits";
import { renderDayIndex, renderOfferMarkdown, type DayIndexRow } from "./markdown";
import type { Channel, DeliveryResult, OutboundOffer } from "./types";

/** Assinatura PNG (magic bytes). */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const SLOT_DAY = /^[0-9]{8}$/;
const SLOT_HHMM = /^[0-9]{4}$/;
const ITEM_ID = /^[0-9]{1,20}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** Nome de um `.md` de slot: `<hhmm>-<itemId>-g<groupIndex>.md`. */
const SLOT_MD_FILE = /^([0-9]{4})-([0-9]{1,20})-g([0-9]{1,2})\.md$/;

export const OUTBOX_CODES = {
  ofertaInvalida: "oferta_invalida",
  linkInvalido: "link_invalido",
  pngInvalido: "png_invalido",
  escritaPng: "escrita_png",
  escritaMd: "escrita_md",
  caminhoInvalido: "caminho_invalido",
  abortado: "abortado",
} as const;

export type OutboxCode = (typeof OUTBOX_CODES)[keyof typeof OUTBOX_CODES];

export interface FileOutboxOptions {
  /** Raiz da outbox. Padrão: `OUTBOX_DIR` do ambiente ou `./outbox` relativo ao cwd. */
  dir?: string;
  /** Ambiente injetável (testes). Padrão: `process.env`. */
  env?: Record<string, string | undefined>;
}

function delivered(ref: string): DeliveryResult {
  return { status: "delivered", ref };
}

function failed(code: OutboxCode): DeliveryResult {
  return { status: "failed", code };
}

/** `child` está dentro de `parent` (comparação por componente de caminho). */
function isInside(parent: string, child: string): boolean {
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(base);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target);
  } catch {
    return null;
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code
  );
}

/** Valida a oferta inteira ANTES de qualquer escrita. Devolve o código fixo da primeira falha, ou `null`. */
function validateOffer(offer: OutboundOffer): OutboxCode | null {
  if (offer === null || typeof offer !== "object") return OUTBOX_CODES.ofertaInvalida;
  const slot = offer.slot;
  if (slot === null || typeof slot !== "object") return OUTBOX_CODES.ofertaInvalida;
  if (typeof slot.day !== "string" || !SLOT_DAY.test(slot.day)) return OUTBOX_CODES.ofertaInvalida;
  if (typeof slot.hhmm !== "string" || !SLOT_HHMM.test(slot.hhmm)) return OUTBOX_CODES.ofertaInvalida;
  if (!Number.isInteger(slot.groupIndex) || slot.groupIndex < 1 || slot.groupIndex > 99) {
    return OUTBOX_CODES.ofertaInvalida;
  }
  if (typeof offer.itemId !== "string" || !ITEM_ID.test(offer.itemId)) return OUTBOX_CODES.ofertaInvalida;
  if (typeof offer.title !== "string" || typeof offer.text !== "string") return OUTBOX_CODES.ofertaInvalida;
  if (typeof offer.groupLabel !== "string") return OUTBOX_CODES.ofertaInvalida;
  if (typeof offer.generatedAtUtc !== "string" || !ISO_UTC.test(offer.generatedAtUtc)) {
    return OUTBOX_CODES.ofertaInvalida;
  }
  if (!isAllowedLink(offer.affiliateLink, AFFILIATE_LINK_HOSTS)) return OUTBOX_CODES.linkInvalido;
  if (!isFiniteNonNegative(offer.priceCurrent) || !isFiniteNonNegative(offer.priceOld)) {
    return OUTBOX_CODES.ofertaInvalida;
  }
  if (!isFiniteNonNegative(offer.discountPct) || offer.discountPct > 100) return OUTBOX_CODES.ofertaInvalida;
  if (!(offer.creativePng instanceof Uint8Array)) return OUTBOX_CODES.pngInvalido;
  if (offer.creativePng.length > MAX_CREATIVE_PNG_BYTES || !hasPngSignature(offer.creativePng)) {
    return OUTBOX_CODES.pngInvalido;
  }
  return null;
}

/** Lê o título do front matter do `.md` (dado cru; quem exibe sanitiza). */
async function readSlotTitle(file: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n");
    if (lines[0] !== "---") return null;
    const end = lines.indexOf("---", 1);
    if (end === -1) return null;
    const parsed: unknown = JSON.parse(lines.slice(1, end).join("\n"));
    if (parsed === null || typeof parsed !== "object") return null;
    const title = (parsed as { title?: unknown }).title;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
}

type MakeTmp = (label: string) => string;

/** Reconstrói `index.md` listando só slots com `.md` (temporários `.`-prefixados e `index.md` ficam fora). */
async function rebuildIndex(dayDir: string, makeTmp: MakeTmp): Promise<void> {
  const entries = await fs.readdir(dayDir, { withFileTypes: true });
  const rows: DayIndexRow[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // ignora pastas e symlinks
    const name = entry.name;
    if (name.startsWith(".") || name === "index.md" || !name.endsWith(".md")) continue;
    const match = SLOT_MD_FILE.exec(name);
    if (match === null) continue;
    const title = await readSlotTitle(join(dayDir, name));
    rows.push({
      hhmm: match[1] ?? "",
      itemId: match[2] ?? "",
      groupIndex: Number(match[3] ?? "0"),
      title: title ?? "",
    });
  }
  rows.sort((a, b) => {
    if (a.hhmm !== b.hhmm) return a.hhmm < b.hhmm ? -1 : 1;
    const itemA = Number(a.itemId);
    const itemB = Number(b.itemId);
    if (itemA !== itemB) return itemA - itemB;
    return a.groupIndex - b.groupIndex;
  });
  const day = dayDir.slice(dayDir.lastIndexOf(sep) + 1);
  const tmp = makeTmp("index");
  await fs.writeFile(tmp, renderDayIndex(day, rows), { flag: "wx", mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, join(dayDir, "index.md"));
}

/**
 * Adaptador de canal que materializa a oferta como arquivos numa pasta local (`outbox/`).
 * O `.md` é o único marcador de "entregue"; o `.png` fica ao lado e um `.md` órfão não conta.
 */
export function createFileOutbox(options: FileOutboxOptions = {}): Channel {
  const env = options.env ?? process.env;
  const root = resolve(options.dir ?? env["OUTBOX_DIR"] ?? join(process.cwd(), "outbox"));
  // Serializa a reconstrução do índice; a corrida do `.md` continua decidida pelo `link` (EEXIST).
  let indexChain: Promise<void> = Promise.resolve();

  const makeTmp = (dir: string): MakeTmp => (label) =>
    // `randomUUID` não depende de estado por instância: duas instâncias no mesmo processo não dividem tmp.
    join(dir, `.${label}.${randomUUID()}.tmp`);

  const scheduleIndex = (dayDir: string): Promise<void> => {
    indexChain = indexChain.then(() => rebuildIndex(dayDir, makeTmp(dayDir))).catch(() => undefined);
    return indexChain;
  };

  const deliver = async (offer: OutboundOffer, opts: { signal: AbortSignal }): Promise<DeliveryResult> => {
    const invalid = validateOffer(offer);
    if (invalid !== null) return failed(invalid);
    if (opts.signal.aborted) return failed(OUTBOX_CODES.abortado);

    const { day, hhmm, groupIndex } = offer.slot;
    const base = `${hhmm}-${offer.itemId}-g${groupIndex}`;
    const slotKey = `${day}/${base}`;
    const dayDir = join(root, day);
    const mdPath = join(dayDir, `${base}.md`);
    const pngPath = join(dayDir, `${base}.png`);

    // Caminho só com campos controlados; raiz tem de conter a pasta do dia.
    if (!isInside(root, dayDir)) return failed(OUTBOX_CODES.caminhoInvalido);

    const dayStat = await lstatOrNull(dayDir);
    if (dayStat !== null && (dayStat.isSymbolicLink() || !dayStat.isDirectory())) {
      return failed(OUTBOX_CODES.caminhoInvalido);
    }
    const mdStat = await lstatOrNull(mdPath);
    if (mdStat !== null && !mdStat.isFile()) return failed(OUTBOX_CODES.caminhoInvalido); // symlink/pasta no slot
    const pngStat = await lstatOrNull(pngPath);
    if (pngStat !== null && !pngStat.isFile()) return failed(OUTBOX_CODES.caminhoInvalido);

    // Marcador de "entregue": o `.md` manda. Idempotente, sem tocar em nada.
    if (mdStat !== null) return delivered(slotKey);

    // (a) PNG primeiro: `.tmp` + rename. Sobrescrever um PNG órfão é permitido (criativo determinístico).
    try {
      await fs.mkdir(dayDir, { recursive: true, mode: 0o700 });
      await fs.chmod(dayDir, 0o700);
      const tmpPng = makeTmp(dayDir)(`${base}.png`);
      await fs.writeFile(tmpPng, offer.creativePng, { flag: "wx", mode: 0o600 });
      await fs.chmod(tmpPng, 0o600);
      await fs.rename(tmpPng, pngPath);
    } catch {
      return failed(OUTBOX_CODES.escritaPng);
    }

    if (opts.signal.aborted) return failed(OUTBOX_CODES.abortado);

    // (b) `.md` por último, publicado com `link` (falha EEXIST se já existir); é o commit.
    try {
      const tmpMd = makeTmp(dayDir)(`${base}.md`);
      await fs.writeFile(tmpMd, renderOfferMarkdown(offer, slotKey), { flag: "wx", mode: 0o600 });
      await fs.chmod(tmpMd, 0o600);
      try {
        await fs.link(tmpMd, mdPath);
      } catch (error) {
        if (!isErrnoCode(error, "EEXIST")) throw error;
        // Corrida: outro gravador publicou o `.md` primeiro. Mesmo `ref`, sem reescrever.
      } finally {
        await fs.unlink(tmpMd).catch(() => undefined);
      }
    } catch {
      return failed(OUTBOX_CODES.escritaMd);
    }

    await scheduleIndex(dayDir);
    return delivered(slotKey);
  };

  return { kind: "file-outbox", deliver };
}
