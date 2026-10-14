"use client";

import { Creative, type CreativeProps } from "@achadinhos/creative";
import { useEffect, useRef, useState } from "react";

/** Mostra o mesmo componente do criativo 1080x1080 (o worker rende o PNG com Satori), escalado ao contêiner. */
export function CreativePreview(props: CreativeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / 1080));
    ro.observe(el);
    setScale(el.clientWidth / 1080);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Prévia do criativo: ${props.title}, ${props.discountPct}% de desconto`}
      className="relative aspect-square w-full overflow-hidden rounded-panel border border-line bg-bg"
    >
      <div style={{ width: 1080, height: 1080, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <Creative {...props} />
      </div>
    </div>
  );
}
