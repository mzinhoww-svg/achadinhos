import { afterAll, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileOutbox } from "../file-outbox";
import type { OutboundOffer } from "../types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const SIGNAL = new AbortController().signal;

const roots: string[] = [];
async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "achadinhos-channel-"));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeOffer(overrides: Partial<OutboundOffer> = {}): OutboundOffer {
  return {
    slot: { day: "20261016", hhmm: "1432", groupIndex: 1 },
    itemId: "123456789",
    title: "Fone Bluetooth",
    text: "Oferta do dia",
    affiliateLink: "https://shope.ee/abc123",
    priceCurrent: 19.9,
    priceOld: 39.9,
    discountPct: 50,
    creativePng: PNG,
    generatedAtUtc: "2026-10-16T18:32:00.000Z",
    groupLabel: "Grupo 1",
    ...overrides,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function slotFiles(dayDir: string): Promise<string[]> {
  return (await readdir(dayDir)).filter((name) => name.endsWith(".md") && name !== "index.md").sort();
}

/** Conta células de uma linha de tabela ignorando `|` escapados (`\|`). */
function countCells(row: string): number {
  return row.split(/(?<!\\)\|/).length - 2;
}

describe("§1 T7-A FileOutbox", () => {
  it("(1) título hostil não vira caminho e é neutralizado no corpo", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const hostile = "../../etc/passwd\n---\n| [x](http://evil) # ` 🔥";

    const result = await channel.deliver(makeOffer({ title: hostile }), { signal: SIGNAL });
    expect(result).toEqual({ status: "delivered", ref: "20261016/1432-123456789-g1" });

    const dayDir = join(root, "20261016");
    expect((await readdir(dayDir)).sort()).toEqual([
      "1432-123456789-g1.md",
      "1432-123456789-g1.png",
      "index.md",
    ]);
    expect((await readdir(root)).sort()).toEqual(["20261016"]);

    const md = await readFile(join(dayDir, "1432-123456789-g1.md"), "utf8");
    // O título cru vive no front matter (JSON de uma linha, escapado); o corpo é que neutraliza.
    const lines = md.split("\n");
    const body = lines.slice(lines.indexOf("---", 1) + 1).join("\n");
    expect(body).not.toContain("[x](http://evil)");
    expect(body).toContain("\\[x\\](http://evil)");
    expect(body).toContain("\\|");
    expect(body).toContain("🔥");
    // O `---` do título não cria delimitador novo: só os dois do front matter.
    expect(lines.filter((line) => line === "---")).toHaveLength(2);
  });

  it("(1) título de 10 000 caracteres é limitado a 500 no arquivo", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    await channel.deliver(makeOffer({ title: "a".repeat(10_000) }), { signal: SIGNAL });

    const md = await readFile(join(root, "20261016", "1432-123456789-g1.md"), "utf8");
    const heading = md.split("\n").find((line) => line.startsWith("# "));
    expect(heading).toBeDefined();
    expect(Array.from((heading ?? "").slice(2)).length).toBe(500);
    expect(md).not.toContain("a".repeat(600));
  });

  it("(1) URL hostil não forja estrutura no .md", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const result = await channel.deliver(makeOffer({ affiliateLink: "https://shope.ee/abc\n\n# Forjado" }), {
      signal: SIGNAL,
    });
    expect(result.status).toBe("delivered");

    const md = await readFile(join(root, "20261016", "1432-123456789-g1.md"), "utf8");
    expect(md.split("\n").some((line) => line.startsWith("# Forjado"))).toBe(false);
  });

  it.each([["abc"], ["12abc"], [""], ["../1"], ["1".repeat(21)], ["12.3"], ["1 2"], ["-1"]])(
    "(2) itemId %j recusado",
    async (itemId) => {
      const root = await tmpRoot();
      const channel = createFileOutbox({ dir: root });
      const result = await channel.deliver(makeOffer({ itemId }), { signal: SIGNAL });
      expect(result).toEqual({ status: "failed", code: "oferta_invalida" });
      expect(await readdir(root)).toEqual([]);
    },
  );

  it.each([
    ["http://shope.ee/abc"],
    ["https://evil.example.com/abc"],
    ["https://shopee.com.br.evil.com/abc"],
    ["https://user:pw@shope.ee/abc"],
    ["not a url"],
    [`https://shope.ee/${"a".repeat(400)}`],
  ])("(3) link fora da allowlist %j recusado", async (affiliateLink) => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const result = await channel.deliver(makeOffer({ affiliateLink }), { signal: SIGNAL });
    expect(result).toEqual({ status: "failed", code: "link_invalido" });
    expect(await readdir(root)).toEqual([]);
  });

  it("(3) link válido em subdomínio da allowlist é aceito", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const result = await channel.deliver(makeOffer({ affiliateLink: "https://promo.shope.ee/x" }), {
      signal: SIGNAL,
    });
    expect(result.status).toBe("delivered");
  });

  it("(4) mesmo slotKey duas vezes → um arquivo só, sem reescrita", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const first = await channel.deliver(makeOffer({ title: "Primeiro" }), { signal: SIGNAL });
    const mdPath = join(root, "20261016", "1432-123456789-g1.md");
    const before = await readFile(mdPath, "utf8");

    const second = await channel.deliver(makeOffer({ title: "Segundo" }), { signal: SIGNAL });
    expect(second).toEqual(first);
    expect(await readFile(mdPath, "utf8")).toBe(before);
    expect(await slotFiles(join(root, "20261016"))).toEqual(["1432-123456789-g1.md"]);
  });

  it("(5) pasta 0700 e arquivos 0600", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    await channel.deliver(makeOffer(), { signal: SIGNAL });

    const dayDir = join(root, "20261016");
    expect((await stat(dayDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dayDir, "1432-123456789-g1.md"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dayDir, "1432-123456789-g1.png"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dayDir, "index.md"))).mode & 0o777).toBe(0o600);
  });

  it("(6) symlink na pasta do dia é recusado", async () => {
    const root = await tmpRoot();
    const outside = await tmpRoot();
    await symlink(outside, join(root, "20261016"));
    const channel = createFileOutbox({ dir: root });

    const result = await channel.deliver(makeOffer(), { signal: SIGNAL });
    expect(result).toEqual({ status: "failed", code: "caminho_invalido" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("(6) symlink no arquivo do slot é recusado e o alvo não é tocado", async () => {
    const root = await tmpRoot();
    const outside = await tmpRoot();
    const dayDir = join(root, "20261016");
    await mkdir(dayDir, { recursive: true });
    const target = join(outside, "alvo.md");
    await writeFile(target, "ALVO");
    await symlink(target, join(dayDir, "1432-123456789-g1.md"));

    const channel = createFileOutbox({ dir: root });
    const result = await channel.deliver(makeOffer(), { signal: SIGNAL });
    expect(result).toEqual({ status: "failed", code: "caminho_invalido" });
    expect(await readFile(target, "utf8")).toBe("ALVO");
  });

  it("(7) index.md correto após 3 entregas com título hostil", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    await channel.deliver(makeOffer({ itemId: "111", title: "Hostil | com pipe ` crase" }), { signal: SIGNAL });
    await channel.deliver(makeOffer({ itemId: "222", title: "Separadores \u2028 e \u2029 fim" }), { signal: SIGNAL });
    await channel.deliver(makeOffer({ itemId: "333", title: "--- linha" }), { signal: SIGNAL });

    const index = await readFile(join(root, "20261016", "index.md"), "utf8");
    expect(index).toContain("\\|");
    expect(index).toContain("\\`");
    expect(index).toContain("\\---");
    expect(index).not.toContain("\u2028");
    expect(index).not.toContain("\u2029");

    const lines = index.split("\n");
    const separator = lines.findIndex((line) => line.startsWith("| --- "));
    const dataRows = lines.slice(separator + 1).filter((line) => line.startsWith("|"));
    expect(dataRows).toHaveLength(3);
    for (const row of dataRows) expect(countCells(row)).toBe(4);
  });

  it("(8) dois grupos, mesmo item e mesmo minuto → 2 arquivos", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const first = await channel.deliver(makeOffer({ slot: { day: "20261016", hhmm: "1432", groupIndex: 1 } }), {
      signal: SIGNAL,
    });
    const second = await channel.deliver(makeOffer({ slot: { day: "20261016", hhmm: "1432", groupIndex: 2 } }), {
      signal: SIGNAL,
    });

    expect(first).toEqual({ status: "delivered", ref: "20261016/1432-123456789-g1" });
    expect(second).toEqual({ status: "delivered", ref: "20261016/1432-123456789-g2" });
    expect(await slotFiles(join(root, "20261016"))).toEqual([
      "1432-123456789-g1.md",
      "1432-123456789-g2.md",
    ]);
  });

  it("(9) canal não calcula tempo: usa o Slot recebido (virada de dia fica na pasta do dia)", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    await channel.deliver(makeOffer({ slot: { day: "20261016", hhmm: "2359", groupIndex: 1 } }), { signal: SIGNAL });
    await channel.deliver(makeOffer({ itemId: "999", slot: { day: "20261016", hhmm: "0001", groupIndex: 2 } }), {
      signal: SIGNAL,
    });

    expect(await exists(join(root, "20261016", "2359-123456789-g1.md"))).toBe(true);
    expect(await exists(join(root, "20261016", "0001-999-g2.md"))).toBe(true);
    expect(await readdir(root)).toEqual(["20261016"]);

    // Nenhum relógio do sistema é consultado: um dia arbitrário é honrado.
    await channel.deliver(makeOffer({ slot: { day: "19990101", hhmm: "1200", groupIndex: 1 } }), { signal: SIGNAL });
    expect(await exists(join(root, "19990101", "1200-123456789-g1.md"))).toBe(true);
  });

  it("(10) falha entre PNG e .md → failed; reexecução conclui", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const fsModule = await import("node:fs");
    const spy = vi
      .spyOn(fsModule.promises, "link")
      .mockRejectedValueOnce(Object.assign(new Error("falha forçada"), { code: "EIO" }));

    let first;
    try {
      first = await channel.deliver(makeOffer(), { signal: SIGNAL });
    } finally {
      spy.mockRestore();
    }

    expect(first).toEqual({ status: "failed", code: "escrita_md" });
    const dayDir = join(root, "20261016");
    expect(await exists(join(dayDir, "1432-123456789-g1.md"))).toBe(false);
    expect(await exists(join(dayDir, "1432-123456789-g1.png"))).toBe(true); // PNG órfão, inofensivo

    const second = await channel.deliver(makeOffer(), { signal: SIGNAL });
    expect(second).toEqual({ status: "delivered", ref: "20261016/1432-123456789-g1" });
    expect(await exists(join(dayDir, "1432-123456789-g1.md"))).toBe(true);
  });

  it("(11) duas gravações concorrentes → um .md, ambas delivered com o mesmo ref", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const [a, b] = await Promise.all([
      channel.deliver(makeOffer(), { signal: SIGNAL }),
      channel.deliver(makeOffer(), { signal: SIGNAL }),
    ]);

    expect(a).toEqual({ status: "delivered", ref: "20261016/1432-123456789-g1" });
    expect(b).toEqual(a);
    const dayDir = join(root, "20261016");
    expect(await slotFiles(dayDir)).toEqual(["1432-123456789-g1.md"]);
    expect((await readdir(dayDir)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["priceCurrent", Number.NaN],
    ["priceCurrent", Number.POSITIVE_INFINITY],
    ["priceCurrent", -1],
    ["priceCurrent", "10"],
    ["priceOld", -0.01],
    ["priceOld", undefined],
    ["discountPct", 101],
    ["discountPct", Number.NaN],
    ["discountPct", Number.POSITIVE_INFINITY],
    ["discountPct", -5],
  ])("(12) número inválido %s=%j recusado", async (field, value) => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const offer = { ...makeOffer(), [field]: value } as OutboundOffer;
    const result = await channel.deliver(offer, { signal: SIGNAL });
    expect(result).toEqual({ status: "failed", code: "oferta_invalida" });
    expect(await readdir(root)).toEqual([]);
  });

  it("(13) PNG sem assinatura ou acima do limite é recusado", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });

    const wrongSignature = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await channel.deliver(makeOffer({ creativePng: wrongSignature }), { signal: SIGNAL })).toEqual({
      status: "failed",
      code: "png_invalido",
    });

    const empty = new Uint8Array(0);
    expect(await channel.deliver(makeOffer({ creativePng: empty }), { signal: SIGNAL })).toEqual({
      status: "failed",
      code: "png_invalido",
    });

    const tooBig = new Uint8Array(5_000_001);
    tooBig.set(PNG, 0);
    expect(await channel.deliver(makeOffer({ creativePng: tooBig }), { signal: SIGNAL })).toEqual({
      status: "failed",
      code: "png_invalido",
    });

    expect(await readdir(root)).toEqual([]);
  });

  it("(14) .md já existente nunca é sobrescrito (nem com conteúdo alheio)", async () => {
    const root = await tmpRoot();
    const dayDir = join(root, "20261016");
    await mkdir(dayDir, { recursive: true, mode: 0o700 });
    const mdPath = join(dayDir, "1432-123456789-g1.md");
    await writeFile(mdPath, "SENTINELA", { mode: 0o600 });

    const channel = createFileOutbox({ dir: root });
    const result = await channel.deliver(makeOffer({ title: "Novo" }), { signal: SIGNAL });

    expect(result).toEqual({ status: "delivered", ref: "20261016/1432-123456789-g1" });
    expect(await readFile(mdPath, "utf8")).toBe("SENTINELA");
    expect(await exists(join(dayDir, "1432-123456789-g1.png"))).toBe(false);
  });

  it("index.md ignora temporários e arquivos que não são slot", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    await channel.deliver(makeOffer(), { signal: SIGNAL });

    const dayDir = join(root, "20261016");
    await writeFile(join(dayDir, ".1432-123456789-g9.md.1.tmp"), "rascunho");
    await writeFile(join(dayDir, "lixo.txt"), "nada");
    await channel.deliver(makeOffer({ itemId: "555", slot: { day: "20261016", hhmm: "1500", groupIndex: 1 } }), {
      signal: SIGNAL,
    });

    const index = await readFile(join(dayDir, "index.md"), "utf8");
    expect(index).not.toContain("g9");
    expect(index).not.toContain("lixo");
    expect(index).toContain("555");
  });

  it("oferta inválida não escreve nada", async () => {
    const root = await tmpRoot();
    const channel = createFileOutbox({ dir: root });
    const result = await channel.deliver(makeOffer({ itemId: "abc" }), { signal: SIGNAL });
    expect(result.status).toBe("failed");
    expect(await readdir(root)).toEqual([]);
  });
});
