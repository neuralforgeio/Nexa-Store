"use client";

/**
 * Global error boundary (v1.8.0) — hanya terpakai bila root layout sendiri
 * gagal render (kasus terparah). Merender dokumen sendiri karena Next.js
 * mengganti seluruh pohon html/body.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[global-error]", error);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#faf9f7",
          color: "#1c1917",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p style={{ fontSize: "40px", margin: 0 }}>🧯</p>
        <h1 style={{ fontSize: "18px", margin: 0 }}>Situs mengalami gangguan sesaat</h1>
        <p style={{ fontSize: "14px", color: "#57534e", maxWidth: "380px", margin: 0 }}>
          Kesalahan internal telah diisolasi. Coba muat ulang halaman.
        </p>
        <button
          onClick={reset}
          style={{
            padding: "10px 18px",
            borderRadius: "10px",
            border: "1px solid #d6d3d1",
            background: "#fff",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Muat ulang
        </button>
      </body>
    </html>
  );
}
