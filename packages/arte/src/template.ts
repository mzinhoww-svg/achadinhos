import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { z } from "zod";

/**
 * T3.4: template por nicho. Fica na bíblia (TEMPLATES-VISUAIS), num bloco ```json:
 *
 * ```json
 * { "padrao": { "cores": { ... } }, "nichos": { "Casa e cozinha": { "cores": { "destaque": "#E85D04" } } } }
 * ```
 *
 * O que faltar vem do padrão abaixo (laranja e branco).
 */
const cor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "cor em hexadecimal, ex.: #E85D04");

export const templateVisual = z.object({
  cores: z
    .object({
      fundo: cor.default("#FFF3EA"),
      cartao: cor.default("#FFFFFF"),
      destaque: cor.default("#E85D04"),
      textoSelo: cor.default("#FFFFFF"),
      texto: cor.default("#1F1F1F"),
      textoSuave: cor.default("#6B6B6B"),
    })
    .prefault({}),
  fonte: z.literal("Inter").default("Inter"),
  marca: z.string().trim().min(1).max(40).default("Achadinhos"),
  /** Logo do grupo como data URI (PNG/SVG). Sem logo, aparece o nome da marca. */
  logo: z
    .string()
    .regex(/^data:image\/(png|jpeg|svg\+xml);base64,/)
    .max(400_000)
    .nullable()
    .default(null),
  posicaoSelo: z.enum(["superior-esquerda", "superior-direita"]).default("superior-direita"),
});
export type TemplateVisual = z.infer<typeof templateVisual>;
export const TEMPLATE_PADRAO: TemplateVisual = templateVisual.parse({});

const parcial = z.record(z.string(), z.unknown());

/** Lê o template do nicho no documento TEMPLATES-VISUAIS da bíblia. Erro de formato cai no padrão. */
export function templateDoNicho(
  documento: string | null | undefined,
  nicho: string | null | undefined,
): { template: TemplateVisual; origem: "biblia-nicho" | "biblia-padrao" | "padrao"; aviso: string | null } {
  if (!documento) return { template: TEMPLATE_PADRAO, origem: "padrao", aviso: null };
  const bloco = /```json\s*\n([\s\S]*?)```/.exec(documento)?.[1];
  if (!bloco) return { template: TEMPLATE_PADRAO, origem: "padrao", aviso: null };
  let json: unknown;
  try {
    json = JSON.parse(bloco);
  } catch {
    return {
      template: TEMPLATE_PADRAO,
      origem: "padrao",
      aviso: "o bloco json de TEMPLATES-VISUAIS não é JSON válido",
    };
  }
  const raiz = z
    .object({ padrao: parcial.optional(), nichos: z.record(z.string(), parcial).optional() })
    .safeParse(json);
  if (!raiz.success)
    return { template: TEMPLATE_PADRAO, origem: "padrao", aviso: "formato de TEMPLATES-VISUAIS inválido" };
  const base = (raiz.data.padrao ?? {}) as Record<string, unknown>;
  const chave = nicho
    ? Object.keys(raiz.data.nichos ?? {}).find((k) => k.toLowerCase() === nicho.toLowerCase())
    : undefined;
  const doNicho = (chave ? raiz.data.nichos?.[chave] : undefined) as Record<string, unknown> | undefined;
  const junto = {
    ...base,
    ...(doNicho ?? {}),
    cores: { ...((base.cores as object) ?? {}), ...((doNicho?.cores as object) ?? {}) },
  };
  const t = templateVisual.safeParse(junto);
  if (!t.success) {
    return {
      template: TEMPLATE_PADRAO,
      origem: "padrao",
      aviso: `template inválido: ${t.error.issues[0]?.message}`,
    };
  }
  return { template: t.data, origem: doNicho ? "biblia-nicho" : "biblia-padrao", aviso: null };
}

export type Formato = "quadrado" | "retrato";
export const DIMENSOES: Record<Formato, { largura: number; altura: number }> = {
  quadrado: { largura: 1080, altura: 1080 },
  retrato: { largura: 1080, altura: 1350 },
};

/** Área reservada ao produto dentro da peça (px), igual para todas as peças do mesmo formato. */
export function areaProduto(formato: Formato) {
  const { largura, altura } = DIMENSOES[formato];
  const margem = 72;
  const topo = 150;
  const rodape = formato === "quadrado" ? 250 : 300;
  return { x: margem, y: topo, largura: largura - 2 * margem, altura: altura - topo - rodape };
}

// ---- Fontes ----

let fontes: { name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" }[] | null = null;

function pastaFontes(): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const candidatas = [process.env.ARTE_FONTES, join(aqui, "fontes"), join(aqui, "..", "fontes")].filter(
    (p): p is string => Boolean(p),
  );
  const achada = candidatas.find((p) => existsSync(join(p, "inter-latin-400-normal.woff")));
  if (!achada) throw new Error(`fontes da Arte não encontradas (procurei em ${candidatas.join(", ")})`);
  return achada;
}

export function carregarFontes() {
  if (fontes) return fontes;
  const p = pastaFontes();
  fontes = ([400, 700, 800] as const).map((weight) => ({
    name: "Inter",
    data: readFileSync(join(p, `inter-latin-${weight}-normal.woff`)),
    weight,
    style: "normal" as const,
  }));
  return fontes;
}

// ---- Elementos (sem React: objetos no formato que o Satori aceita) ----

type Estilo = Record<string, string | number>;
interface No {
  type: string;
  key: null;
  props: { style?: Estilo; children?: (No | string)[] | No | string; [k: string]: unknown };
}
const h = (type: string, props: Record<string, unknown>, ...children: (No | string | null | false)[]): No => {
  const filhos = children.filter((c): c is No | string => c !== null && c !== false);
  return { type, key: null, props: { ...props, ...(filhos.length ? { children: filhos } : {}) } };
};

export function formatarPreco(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v).replace(/\s/g, " ");
}

export interface DadosPeca {
  formato: Formato;
  template: TemplateVisual;
  /** PNG já padronizado, do tamanho exato de areaProduto(formato). */
  produtoPng: Buffer;
  preco: number;
  precoAntigo: number | null;
  descontoPct: number | null;
}

/** Monta o layout e devolve o PNG final no tamanho do formato. */
export async function desenharPeca(d: DadosPeca): Promise<Buffer> {
  const { largura, altura } = DIMENSOES[d.formato];
  const area = areaProduto(d.formato);
  const c = d.template.cores;
  const desconto = d.descontoPct != null && d.descontoPct >= 1 ? Math.round(d.descontoPct) : null;
  const seloDireita = d.template.posicaoSelo === "superior-direita";

  const marca = d.template.logo
    ? h("img", { src: d.template.logo, height: 64, style: { height: 64, objectFit: "contain" } })
    : h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            padding: "14px 28px",
            borderRadius: 999,
            backgroundColor: c.destaque,
            color: c.textoSelo,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: -0.5,
          },
        },
        d.template.marca,
      );

  const selo = desconto
    ? h(
        "div",
        {
          style: {
            position: "absolute",
            top: 40,
            ...(seloDireita ? { right: 48 } : { left: 48 }),
            width: 190,
            height: 190,
            borderRadius: 999,
            backgroundColor: c.destaque,
            color: c.textoSelo,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          },
        },
        h(
          "div",
          {
            style: { fontSize: desconto >= 10 ? 58 : 66, fontWeight: 800, lineHeight: 1, letterSpacing: -2 },
          },
          `-${desconto}%`,
        ),
        h("div", { style: { fontSize: 32, fontWeight: 800, marginTop: 4 } }, "OFF"),
      )
    : null;

  const precos = h(
    "div",
    {
      style: {
        position: "absolute",
        left: 72,
        right: 72,
        bottom: d.formato === "quadrado" ? 56 : 80,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
      },
    },
    d.precoAntigo && d.precoAntigo > d.preco
      ? h(
          "div",
          {
            style: {
              fontSize: 40,
              fontWeight: 400,
              color: c.textoSuave,
              textDecoration: "line-through",
            },
          },
          `De ${formatarPreco(d.precoAntigo)}`,
        )
      : null,
    h(
      "div",
      { style: { display: "flex", alignItems: "baseline", color: c.texto } },
      h("div", { style: { fontSize: 44, fontWeight: 700, marginRight: 16 } }, "Por"),
      h(
        "div",
        {
          style: {
            fontSize: d.formato === "quadrado" ? 112 : 124,
            fontWeight: 800,
            letterSpacing: -3,
            lineHeight: 1,
          },
        },
        formatarPreco(d.preco),
      ),
    ),
  );

  const raiz = h(
    "div",
    {
      style: {
        width: largura,
        height: altura,
        display: "flex",
        position: "relative",
        backgroundColor: c.fundo,
        fontFamily: "Inter",
      },
    },
    // Cartão claro atrás do produto.
    h("div", {
      style: {
        position: "absolute",
        left: area.x - 24,
        top: area.y - 24,
        width: area.largura + 48,
        height: area.altura + 48,
        borderRadius: 48,
        backgroundColor: c.cartao,
      },
    }),
    h("img", {
      src: `data:image/png;base64,${d.produtoPng.toString("base64")}`,
      width: area.largura,
      height: area.altura,
      style: { position: "absolute", left: area.x, top: area.y, width: area.largura, height: area.altura },
    }),
    h(
      "div",
      {
        style: {
          position: "absolute",
          top: 44,
          ...(seloDireita ? { left: 48 } : { right: 48 }),
          display: "flex",
        },
      },
      marca,
    ),
    selo,
    precos,
  );

  // biome-ignore lint/suspicious/noExplicitAny: o Satori espera ReactNode; o objeto tem o mesmo formato.
  const svg = await satori(raiz as any, { width: largura, height: altura, fonts: carregarFontes() });
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng(),
  );
}
