import sharp from "sharp";

/**
 * T3.2: remoção de fundo dentro do worker, com sharp (sem modelo de IA).
 *
 * Fotos de produto da Shopee costumam ter fundo liso e claro. O algoritmo:
 * 1. estima a cor do fundo pela mediana do anel de borda;
 * 2. mede quanto da borda tem essa cor (uniformidade);
 * 3. inunda a partir das bordas tudo o que estiver perto da cor do fundo: isso é o fundo;
 * 4. o resto é o produto. A borda da máscara recebe um leve desfoque.
 *
 * A confiança (0 a 1) junta a uniformidade da borda e se a área do produto é plausível (entre 4% e 92%).
 * Foto com fundo cheio de detalhes dá confiança baixa e vai para o fallback (T3.6). Nada aqui muda os
 * pixels do produto: o recorte só define a transparência do fundo.
 */

export interface Recorte {
  /** PNG RGBA do tamanho da foto, com o fundo transparente. */
  png: Buffer;
  /** Máscara em tons de cinza (branco = produto). */
  mascara: Buffer;
  confianca: number;
  /** Fração da imagem ocupada pelo produto. */
  areaProduto: number;
  /** Caixa do produto na imagem (px). */
  caixa: { x: number; y: number; largura: number; altura: number };
  largura: number;
  altura: number;
  motivoBaixaConfianca: string | null;
}

const TRABALHO = 900; // lado maior usado para calcular a máscara

export async function recortarFundo(foto: Buffer, opcoes: { tolerancia?: number } = {}): Promise<Recorte> {
  const base = sharp(foto).rotate();
  const meta = await base.metadata();
  const largura = meta.width ?? 0;
  const altura = meta.height ?? 0;
  if (!largura || !altura) throw new Error("imagem sem dimensões");

  // Foto que já vem com transparência real: usa o alfa dela.
  if (meta.hasAlpha) {
    const { data, info } = await sharp(foto)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let transparentes = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 16) transparentes++;
    const frac = transparentes / (info.width * info.height);
    if (frac > 0.05)
      return montar(foto, extrairAlfa(data, info.width, info.height), info.width, info.height, 0.95, null);
  }

  const escala = Math.min(1, TRABALHO / Math.max(largura, altura));
  const w = Math.max(1, Math.round(largura * escala));
  const h = Math.max(1, Math.round(altura * escala));
  const { data } = await sharp(foto)
    .rotate()
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0] as const;
  };

  // 1-2. Cor do fundo e uniformidade da borda.
  const borda: (readonly [number, number, number])[] = [];
  for (let x = 0; x < w; x++) {
    borda.push(px(x, 0), px(x, h - 1));
  }
  for (let y = 1; y < h - 1; y++) {
    borda.push(px(0, y), px(w - 1, y));
  }
  const mediana = (k: 0 | 1 | 2) => {
    const v = borda.map((c) => c[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 255;
  };
  const fundo = [mediana(0), mediana(1), mediana(2)] as const;
  const tol = opcoes.tolerancia ?? 30;
  const tol2 = tol * tol;
  const perto = (c: readonly [number, number, number]) =>
    (c[0] - fundo[0]) ** 2 + (c[1] - fundo[1]) ** 2 + (c[2] - fundo[2]) ** 2 <= tol2;
  const uniformidade = borda.filter(perto).length / borda.length;

  // 3. Inundação a partir das bordas (fila, sem recursão).
  const ehFundo = new Uint8Array(w * h);
  const fila = new Int32Array(w * h);
  let ini = 0;
  let fim = 0;
  const semear = (x: number, y: number) => {
    const i = y * w + x;
    if (!ehFundo[i] && perto(px(x, y))) {
      ehFundo[i] = 1;
      fila[fim++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    semear(x, 0);
    semear(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    semear(0, y);
    semear(w - 1, y);
  }
  while (ini < fim) {
    const i = fila[ini++] ?? 0;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) semear(x - 1, y);
    if (x < w - 1) semear(x + 1, y);
    if (y > 0) semear(x, y - 1);
    if (y < h - 1) semear(x, y + 1);
  }

  // 4. Máscara, área e confiança.
  const mascaraPequena = Buffer.alloc(w * h);
  let produto = 0;
  for (let i = 0; i < w * h; i++) {
    if (!ehFundo[i]) {
      mascaraPequena[i] = 255;
      produto++;
    }
  }
  const area = produto / (w * h);
  let motivo: string | null = null;
  let confianca = uniformidade;
  if (uniformidade < 0.85) motivo = "fundo sem cor uniforme";
  if (area < 0.04) {
    confianca *= 0.2;
    motivo = "quase nada sobrou do produto";
  } else if (area > 0.92) {
    confianca *= 0.3;
    motivo = "o fundo não se separou do produto";
  }
  confianca = Math.round(Math.max(0, Math.min(1, confianca)) * 100) / 100;

  const mascara = await sharp(mascaraPequena, { raw: { width: w, height: h, channels: 1 } })
    .resize(largura, altura, { kernel: "lanczos3" })
    .blur(1)
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  return montar(foto, mascara, largura, altura, confianca, motivo, area);
}

function extrairAlfa(rgba: Buffer, w: number, h: number): Buffer {
  const a = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) a[i] = rgba[i * 4 + 3] ?? 255;
  return a;
}

async function montar(
  foto: Buffer,
  mascaraRaw: Buffer,
  largura: number,
  altura: number,
  confianca: number,
  motivo: string | null,
  areaInformada?: number,
): Promise<Recorte> {
  // Caixa do produto: limites da máscara acima de 50%.
  let x0 = largura;
  let y0 = altura;
  let x1 = -1;
  let y1 = -1;
  let cheios = 0;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if ((mascaraRaw[y * largura + x] ?? 0) > 127) {
        cheios++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const caixa =
    x1 < 0 ? { x: 0, y: 0, largura, altura } : { x: x0, y: y0, largura: x1 - x0 + 1, altura: y1 - y0 + 1 };
  const rgb = await sharp(foto).rotate().removeAlpha().raw().toBuffer();
  const png = await sharp(rgb, { raw: { width: largura, height: altura, channels: 3 } })
    .joinChannel(mascaraRaw, { raw: { width: largura, height: altura, channels: 1 } })
    .png()
    .toBuffer();
  const mascara = await sharp(mascaraRaw, { raw: { width: largura, height: altura, channels: 1 } })
    .png()
    .toBuffer();
  return {
    png,
    mascara,
    confianca,
    areaProduto: Math.round((areaInformada ?? cheios / (largura * altura)) * 1000) / 1000,
    caixa,
    largura,
    altura,
    motivoBaixaConfianca: motivo,
  };
}
