/** Marca: etiqueta de preço com furo — "achadinhos" em Bricolage. */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <path d="M4 5h13l11 11-11 11L4 16V5z" fill="#8d1071" />
        <circle cx="10" cy="11" r="2.4" fill="#f7d22a" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight text-ink">achadinhos</span>
    </span>
  );
}
