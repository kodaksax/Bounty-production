import type React from "react"
//import "app/globals.css"
import { ThemeProvider } from "components/theme-provider"

export const metadata = {
  title: "Bounty App",
  description: "Find and complete bounties near you",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no",
  appleMobileWebAppCapable: "yes",
  appleStatusBarStyle: "black-translucent",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* <meta name="apple-mobile-web-app-capable" content="yes" /> */}
        {/* <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" /> */}
        {/* <meta name="theme-color" content="#10b981" /> */}
      </head>
      <body className="bg-emerald-600">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <div className="iphone-container">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  )
}
