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
import { isEmptyPreview } from "@/lib/mock";
import { container, viewSession } from "@/server/context";
import { IconSend } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Ofertas" };

export default async function OfertasPage({ searchParams }: { searchParams: Promise<{ vazio?: string; q?: string }> }) {
  const sp = await searchParams;
  const empty = isEmptyPreview(sp);
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const c = await container();
  const session = await viewSession(c, empty);
  const all = session ? await c.sendNow.listOffers(session.accountId) : [];
  const list = all
    .filter((o) => !q || o.title.toLowerCase().includes(q) || o.shopName.toLowerCase().includes(q))
    .map((o) => ({ ...o, hue: o.placeholderHue ?? 340, label: "", discount: o.oldPrice > o.price ? Math.round((1 - o.price / o.oldPrice) * 100) : 0 }));

  return (
    <>
      <PageHeader title="Ofertas" description="Produtos buscados na Shopee que passaram pelos filtros das suas automações." />

      <Card className="mb-6">
        <form className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" role="search" aria-label="Filtrar ofertas">
          <Field label="Buscar" htmlFor="q">
            <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Nome do produto ou da loja" />
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
          action={
            q ? (
              <Button href="/ofertas" variant="secondary">Limpar busca</Button>
            ) : (
              <>
                <Button href="/mandar-agora" icon={<IconSend width={18} height={18} />}>Mandar agora</Button>
                <Button href="/automacoes/nova" variant="secondary">Criar automação</Button>
              </>
            )
          }
        >
          {q
            ? "Tente outro nome de produto ou loja, ou limpe a busca para ver tudo."
            : "As ofertas aparecem depois que uma automação busca produtos ou que você manda uma oferta agora. Conecte a Shopee e crie uma automação para começar."}
        </EmptyState>
      ) : (
        <Card flush>
          <DataTable
            caption="Ofertas"
            rows={list}
            rowKey={(o) => o.itemId}
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
                      <span className="text-xs text-ink-3">{o.shopName}</span>
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
              { key: "off", header: "Desconto", cell: (o) => <Badge tone="warn">-{o.discount}%</Badge> },
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
