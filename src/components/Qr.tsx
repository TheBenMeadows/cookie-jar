import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QR code image for a payment link or jar URL.
 * Generates the QR code data URL asynchronously and handles loading and error states.
 */
export function Qr({ value, alt }: { value: string; alt: string }): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDataUrl(null);
    setError(null);

    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (live) setDataUrl(url);
      })
      .catch((e: unknown) => {
        if (live) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      live = false;
    };
  }, [value]);

  if (error) {
    return <p className="alarm">{error}</p>;
  }

  if (!dataUrl) {
    return <p className="working">Drawing the code…</p>;
  }

  return <img className="qr" src={dataUrl} alt={alt} />;
}
