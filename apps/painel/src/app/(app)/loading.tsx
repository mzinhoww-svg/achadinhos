export default function Carregando() {
  return (
    <div role="status" className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      {Array.from({ length: 5 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: esqueleto estático.
        <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
