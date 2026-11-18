import sharp from "sharp";
import { ampliarSePreciso } from "./foto.ts";
import { type Recorte, recortarFundo } from "./recorte.ts";
import { areaProduto, desenharPeca, type Formato, type TemplateVisual } from "./template.ts";

/** Fração da área reservada que o produto ocupa: igual em todas as peças (T3.3). */
const FRACAO_AREA = 0.5;

/**
 * T3.3: produto recortado, centralizado, sempre com a mesma área visual, e uma sombra leve embaixo.
 * Só redimensiona (proporção mantida) e posiciona: os pixels do produto não mudam.
 */
export async function padronizar(recorte: Recorte, formato: Formato): Promise<Buffer> {
  const area = areaProduto(formato);
  const { caixa } = recorte;
  const produto = await sharp(recorte.png)
    .extract({ left: caixa.x, top: caixa.y, width: caixa.largura, height: caixa.altura })
    .png()
    .toBuffer();
  const sombraAltura = Math.round(area.altura * 0.06);
  const disponivelAltura = area.altura - sombraAltura;
  const porArea = Math.sqrt((FRACAO_AREA * area.largura * area.altura) / (caixa.largura * caixa.altura));
  const escala = Math.min(
    porArea,
    (area.largura * 0.92) / caixa.largura,
    (disponivelAltura * 0.95) / caixa.altura,
  );
  const w = Math.max(1, Math.round(caixa.largura * escala));
  const hh = Math.max(1, Math.round(caixa.altura * escala));
  const redimensionado = await sharp(produto).resize(w, hh, { kernel: "lanczos3" }).png().toBuffer();
  const x = Math.round((area.largura - w) / 2);
  const y = Math.round((disponivelAltura - hh) / 2);
  const sombraW = Math.round(w * 0.8);
  const sombra = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${area.largura}" height="${area.altura}">
      <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.round(sombraAltura / 2.5)}"/></filter></defs>
      <ellipse cx="${area.largura / 2}" cy="${y + hh}" rx="${sombraW / 2}" ry="${Math.max(6, sombraAltura / 2)}" fill="#000" fill-opacity="0.18" filter="url(#b)"/>
    </svg>`,
  );
  return sharp({
    create: {
      width: area.largura,
      height: area.altura,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: sombra, left: 0, top: 0 },
      { input: redimensionado, left: x, top: y },
    ])
    .png()
    .toBuffer();
}

/** T3.6: foto original inteira (sem recorte), num quadro branco arredondado dentro da área do produto. */
export async function molduraOriginal(foto: Buffer, formato: Formato): Promise<Buffer> {
  const area = areaProduto(formato);
  const margem = 16;
  const lado = { w: area.largura - 2 * margem, h: area.altura - 2 * margem };
  const foto2 = await sharp(foto)
    .rotate()
    .resize(lado.w, lado.h, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      kernel: "lanczos3",
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const raio = 32;
  const mascara = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado.w}" height="${lado.h}"><rect width="100%" height="100%" rx="${raio}" ry="${raio}" fill="#fff"/></svg>`,
  );
  const arredondada = await sharp(foto2)
    .composite([{ input: mascara, blend: "dest-in" }])
    .png()
    .toBuffer();
  const borda = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado.w}" height="${lado.h}"><rect x="1.5" y="1.5" width="${lado.w - 3}" height="${lado.h - 3}" rx="${raio}" ry="${raio}" fill="none" stroke="#E4E4E4" stroke-width="3"/></svg>`,
  );
  return sharp({
    create: {
      width: area.largura,
      height: area.altura,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: arredondada, left: margem, top: margem },
      { input: borda, left: margem, top: margem },
    ])
    .png()
    .toBuffer();
}

export interface EntradaPeca {
  foto: Buffer;
  formatos: Formato[];
  template: TemplateVisual;
  preco: number;
  precoAntigo: number | null;
  descontoPct: number | null;
  /** Abaixo disto o recorte não é usado (padrão 0,8). */
  limiarConfianca?: number;
  /** Força o fallback (teste de aceite / ajuste manual). */
  forcarFallback?: boolean;
}

export interface PecaRenderizada {
  formato: Formato;
  /** JPEG 1080 x 1080 ou 1080 x 1350. */
  jpeg: Buffer;
  largura: number;
  altura: number;
}

export interface ResultadoArte {
  pecas: PecaRenderizada[];
  /** Máscara do recorte (PNG, branco = produto). Null quando o recorte nem foi calculado. */
  mascara: Buffer | null;
  confianca: number;
  fallback: boolean;
  motivoFallback: string | null;
  ampliada: boolean;
  fatorAmpliacao: number;
  areaProduto: number | null;
}

/** Pipeline completo: amplia se preciso, recorta, decide o fallback e desenha cada formato. */
export async function gerarArte(e: EntradaPeca): Promise<ResultadoArte> {
  const limiar = e.limiarConfianca ?? 0.8;
  const ampliacao = await ampliarSePreciso(e.foto);
  let recorte: Recorte | null = null;
  let motivo: string | null = null;
  try {
    recorte = await recortarFundo(ampliacao.buffer);
  } catch (err) {
    motivo = `recorte falhou: ${(err as Error).message}`;
  }
  if (!motivo && recorte && recorte.confianca < limiar) {
    motivo = `confiança ${recorte.confianca.toFixed(2)} abaixo de ${limiar}${recorte.motivoBaixaConfianca ? ` (${recorte.motivoBaixaConfianca})` : ""}`;
  }
  if (e.forcarFallback) motivo = "fallback forçado";
  const fallback = motivo !== null;

  const pecas: PecaRenderizada[] = [];
  for (const formato of e.formatos) {
    const produtoPng =
      fallback || !recorte
        ? await molduraOriginal(ampliacao.buffer, formato)
        : await padronizar(recorte, formato);
    const png = await desenharPeca({
      formato,
      template: e.template,
      produtoPng,
      preco: e.preco,
      precoAntigo: e.precoAntigo,
      descontoPct: e.descontoPct,
    });
    const jpeg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const meta = await sharp(jpeg).metadata();
    pecas.push({ formato, jpeg, largura: meta.width ?? 0, altura: meta.height ?? 0 });
  }
  return {
    pecas,
    mascara: recorte?.mascara ?? null,
    confianca: recorte?.confianca ?? 0,
    fallback,
    motivoFallback: motivo,
    ampliada: ampliacao.ampliada,
    fatorAmpliacao: ampliacao.fator,
    areaProduto: recorte?.areaProduto ?? null,
  };
}
