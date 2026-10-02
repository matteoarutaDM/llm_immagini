export const metadata = {
  title: { template: "%s · Backoffice", default: "Backoffice" },
  description: "Central operations per la generazione di immagini AI",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }) {
  return children;
}
