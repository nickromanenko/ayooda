import type { Metadata } from 'next'
import Script from 'next/script'
import { Montserrat } from 'next/font/google'
import { JetBrains_Mono } from 'next/font/google'
import { AuthProvider } from '@/components/providers/AuthProvider'
import { MixpanelAnalytics } from '@/components/providers/MixpanelAnalytics'
import { AppInteractionProvider } from '@/components/ui/AppInteractionProvider'
import './globals.css'

const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  style: ['normal', 'italic'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'Ayooda — AI support agent for modern teams',
  description: 'Resolve routine support tickets end-to-end. Ayooda gives customers grounded answers, takes guarded actions, and hands off the exceptions.',
}

const themeScript = `(()=>{try{const key='ayooda.theme';const saved=localStorage.getItem(key);const theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch{document.documentElement.dataset.theme='dark'}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{themeScript}</Script>
      </head>
      <body className="h-full">
        <MixpanelAnalytics />
        <AppInteractionProvider><AuthProvider>{children}</AuthProvider></AppInteractionProvider>
      </body>
    </html>
  )
}
