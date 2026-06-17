"use client";

import { useEffect, useState } from "react";
import QR from "qrcode";

/** Renders a QR code for `value` as an <img>. Generated client-side. */
export function QRCode({ value, size = 200 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QR.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#14171e", light: "#faf7f0" },
    })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src)
    return (
      <div
        style={{
          width: size,
          height: size,
          maxWidth: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 12,
          background: "var(--ink-soft)",
        }}
      />
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data-URL QR; next/image cannot optimise it
    <img
      src={src}
      width={size}
      height={size}
      alt="QR-kode for å bli med"
      // never overflow a narrow container; keep it square
      style={{ borderRadius: 12, background: "var(--paper)", maxWidth: "100%", height: "auto" }}
    />
  );
}
