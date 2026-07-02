/* Inkwell Drop — the capture-only mini-PWA.
   Its own manifest (scope /capture) makes Android install it as a SEPARATE
   app (its own WebAPK/package), so app blockers like Brick can exempt it
   while Chrome and the full Inkwell app stay blocked. */
export const metadata = {
  title: "Inkwell Drop — Scan a Page",
  description: "Scan a notebook page into Inkwell — nothing else",
  manifest: "/capture.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Inkwell Drop",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#8a5a33",
};

export default function CaptureLayout({ children }) {
  return children;
}
