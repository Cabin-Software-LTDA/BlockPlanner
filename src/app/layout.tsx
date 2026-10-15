import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "TimeBlock — A little structure. More room to focus.",
  description:
    "Your day, thoughtfully arranged. A private, local-first daily planner.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
