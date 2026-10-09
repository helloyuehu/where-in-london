import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./map-overrides.css";

export const metadata: Metadata = {
  title: "London Rental Fit",
  description: "Explore which parts of Greater London fit your commute, rent and reported-crime constraints.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
