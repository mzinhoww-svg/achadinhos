/** Marca as telas que ainda usam dados falsos (src/lib/demo.ts). */
export function FaixaDemo({ motivo }: { motivo: string }) {
  return (
    <p className="rounded-lg border border-dashed border-amber-400/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
      <strong>Demonstração:</strong> dados falsos. {motivo}
    </p>
  );
}
