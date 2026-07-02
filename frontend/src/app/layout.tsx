import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClusterDash | Distributed Swarm Monitor",
  description: "Industry-grade visual monitoring dashboard for Docker Swarm and Node Exporter clusters.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
