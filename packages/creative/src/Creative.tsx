import type { CSSProperties } from "react";
import { CREATIVE_SIZE, fontFamily, palette } from "./tokens.ts";
import { formatBRL } from "./format.ts";

export interface CreativeProps {
  title: string;
  imageUrl: string;
  priceCurrent: number;
  priceOld: number;
  discountPct: number;
  /** Com ou sem "@". */
  affiliateHandle: string;
}

/**
 * Criativo 1080x1080 do envio. Compatível com Satori: só flexbox, estilos inline,
 * sem classes, sem grid, sem var(). Renderiza igual no DOM (preview do painel) e em PNG (worker).
 */
export function Creative({ title, imageUrl, priceCurrent, priceOld, discountPct, affiliateHandle }: CreativeProps) {
  const handle = affiliateHandle.startsWith("@") ? affiliateHandle : `@${affiliateHandle}`;
  const root: CSSProperties = {
    width: CREATIVE_SIZE,
    height: CREATIVE_SIZE,
    display: "flex",
    flexDirection: "column",
    backgroundColor: palette.white,
    fontFamily: fontFamily.text,
    color: palette.ink,
  };
  return (
    <div style={root}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "48px 48px 0 48px" }}>
      <div style={{ display: "flex", position: "relative", width: 984, height: 600 }}>
        <img
          src={imageUrl}
          width={984}
          height={600}
          style={{ width: 984, height: 600, objectFit: "cover", borderRadius: 40, backgroundColor: palette.sunken }}
        />
        <div
          style={{
            position: "absolute",
            top: -16,
            right: -16,
            width: 216,
            height: 216,
            borderRadius: 108,
            backgroundColor: palette.sun,
            color: palette.sunInk,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(-8deg)",
            border: `8px solid ${palette.white}`,
          }}
        >
          <div style={{ display: "flex", fontFamily: fontFamily.display, fontWeight: 800, fontSize: 68, lineHeight: 1 }}>
            {`-${discountPct}%`}
          </div>
          <div style={{ display: "flex", fontWeight: 700, fontSize: 30, letterSpacing: 2 }}>OFF</div>
        </div>
      </div>

      <div
        style={{
          display: "block",
          height: 116,
          overflow: "hidden",
          marginTop: 32,
          fontFamily: fontFamily.display,
          fontWeight: 700,
          fontSize: 50,
          lineHeight: 1.15,
          lineClamp: 2,
          width: 984,
        }}
      >
        {title}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            fontFamily: fontFamily.display,
            fontWeight: 800,
            fontSize: 116,
            lineHeight: 1,
            color: palette.plum600,
          }}
        >
          {formatBRL(priceCurrent)}
        </div>
        <div
          style={{
            display: "flex",
            marginLeft: 28,
            marginBottom: 10,
            fontWeight: 600,
            fontSize: 42,
            color: palette.ink3,
            textDecoration: "line-through",
          }}
        >
          {formatBRL(priceOld)}
        </div>
      </div>

      </div>
      <div
        style={{
          alignSelf: "stretch",
          flexShrink: 0,
          height: 96,
          backgroundColor: palette.plum600,
          color: palette.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 48,
          paddingRight: 48,
          fontSize: 34,
          fontWeight: 700,
        }}
      >
        <div style={{ display: "flex" }}>{handle}</div>
        <div style={{ display: "flex", fontWeight: 600, fontSize: 28, color: palette.plum50 }}>oferta Shopee</div>
      </div>
    </div>
  );
}
