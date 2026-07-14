import "./globals.css";

export const metadata = {
  title: "Initiation CDC",
  description: "Interface de relecture et validation des fiches projet."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
