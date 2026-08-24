import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import { JetBrains_Mono } from 'next/font/google'
import { AuthProvider } from '@/components/providers/AuthProvider'
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
