import type { Metadata } from "next";
import { ProductThumb } from "@/components/product-thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { IconSearch, IconStar, IconTag } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { formatBRL, formatInt } from "@/lib/format";
import { discountOf, isEmptyPreview, offers } from "@/lib/mock";

export const metadata: Metadata = { title: "Ofertas" };

export default async function OfertasPage({ searchParams }: { searchParams: Promise<{ vazio?: string; q?: string }> }) {
  const sp = await searchParams;
  const empty = isEmptyPreview(sp);
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = empty ? [] : offers.filter((o) => !q || o.title.toLowerCase().includes(q) || o.category.toLowerCase().includes(q));

  return (
    <>
      <PageHeader title="Ofertas" description="Produtos buscados na Shopee que passaram pelos filtros das suas automações." />

      <Card className="mb-6">
        <form className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" role="search" aria-label="Filtrar ofertas">
          <Field label="Buscar" htmlFor="q">
            <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Nome ou categoria" />
          </Field>
          <Field label="Ordenar por" htmlFor="sort">
            <Select id="sort" name="sort" defaultValue="desconto">
              <option value="desconto">Maior desconto</option>
              <option value="comissao">Maior comissão</option>
              <option value="vendas">Mais vendidos</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary" icon={<IconSearch width={18} height={18} />}>Filtrar</Button>
        </form>
      </Card>

      {list.length === 0 ? (
        <EmptyState
          icon={<IconTag />}
          title={q ? "Nenhuma oferta para essa busca" : "Nenhuma oferta ainda"}
          action={<Button href={q ? "/ofertas" : "/automacoes/nova"} variant="secondary">{q ? "Limpar busca" : "Criar automação"}</Button>}
        >
          {q
            ? "Tente outro nome ou categoria, ou limpe a busca para ver tudo."
            : "As ofertas aparecem depois que uma automação busca produtos na Shopee. Conecte a Shopee e crie uma automação para começar."}
        </EmptyState>
      ) : (
        <Card flush>
          <DataTable
            caption="Ofertas"
            rows={list}
            rowKey={(o) => o.id}
            columns={[
              {
                key: "title",
                header: "Produto",
                mobile: "title",
                cell: (o) => (
                  <span className="flex items-center gap-3">
                    <ProductThumb offer={o} size={44} />
                    <span className="min-w-0">
                      <span className="line-clamp-2 font-semibold">{o.title}</span>
                      <span className="text-xs text-ink-3">{o.category}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: "price",
                header: "Preço",
                cell: (o) => (
                  <span className="whitespace-nowrap">
                    <strong className="tabular-nums">{formatBRL(o.price)}</strong>{" "}
                    <s className="text-ink-3 tabular-nums">{formatBRL(o.oldPrice)}</s>
                  </span>
                ),
              },
              { key: "off", header: "Desconto", cell: (o) => <Badge tone="warn">-{discountOf(o)}%</Badge> },
              { key: "comm", header: "Comissão", align: "right", cell: (o) => `${String(o.commissionRate).replace(".", ",")}%` },
              {
                key: "rating",
                header: "Nota",
                cell: (o) => (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <IconStar width={14} height={14} className="text-sun-ink" /> {String(o.rating).replace(".", ",")}
                  </span>
                ),
              },
              { key: "sales", header: "Vendas", align: "right", cell: (o) => formatInt(o.sales) },
            ]}
          />
        </Card>
      )}
    </>
  );
}
