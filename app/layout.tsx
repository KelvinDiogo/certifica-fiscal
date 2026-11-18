import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Certifica | Regularidade fiscal",
  description:
    "Certidões, caixa postal fiscal, obrigações, conciliação de estoque e rotinas de ERP.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
