import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CodeGraph Enterprise",
  description: "Code knowledge graph platform for AI programming tools",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
