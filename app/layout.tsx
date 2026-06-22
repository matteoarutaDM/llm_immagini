import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Assistente Macchine",
  description: "Riconoscimento macchina da immagine con RAG sui manuali tecnici",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
