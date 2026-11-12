"use client";

// Last-resort page when the root layout itself fails. It must bring its own <html> and <body>, and uses plain styles
// because the app's stylesheet may not have loaded.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f8fafc", color: "#10233f" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }}>
          <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>ToProt is having trouble</h1>
          <p style={{ lineHeight: 1.6, margin: "0 0 20px" }}>Something went wrong on our side. Your work is saved. Please try again in a moment.</p>
          <button type="button" onClick={reset} style={{ background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 6, padding: "12px 20px", fontSize: 14, cursor: "pointer" }}>Try again</button>
          {error.digest && <p style={{ fontSize: 12, opacity: 0.6, marginTop: 24 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
