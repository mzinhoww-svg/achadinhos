/** Foto fictícia (SVG data URI) para mocks e testes — nunca depende de rede. */
export function productPlaceholder(hue = 340, label = ""): string {
  const a = `hsl(${hue} 70% 88%)`;
  const b = `hsl(${(hue + 40) % 360} 60% 72%)`;
  const c = `hsl(${hue} 55% 38%)`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="800" height="800" fill="url(#g)"/>` +
    `<circle cx="560" cy="250" r="150" fill="#ffffff" fill-opacity="0.45"/>` +
    `<rect x="190" y="330" width="420" height="300" rx="48" fill="${c}"/>` +
    `<rect x="260" y="250" width="280" height="110" rx="40" fill="none" stroke="${c}" stroke-width="28"/>` +
    `<text x="400" y="505" font-family="sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="#ffffff">${label.replace(/[<&>]/g, "")}</text>` +
    `</svg>`;
  // base64 de bytes UTF-8 (btoa puro quebra com acentos).
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
