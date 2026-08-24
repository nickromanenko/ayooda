'use client'

import { useEffect } from 'react'
import { initializeProductAnalytics, trackProductEvent } from '@/lib/product-analytics'

export function MixpanelAnalytics() {
  useEffect(() => {
    initializeProductAnalytics()

    function trackLandingCta(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      const cta = target.closest<HTMLAnchorElement>('a.landing-cta')
      if (!cta) return

      const destination = new URL(cta.href, window.location.href)
      trackProductEvent('Marketing CTA Clicked', {
        cta: (cta.textContent ?? 'CTA').replace(/\s+/g, ' ').trim().slice(0, 80),
        destination: destination.origin === window.location.origin ? destination.pathname : destination.hostname,
        page: window.location.pathname,
      })
    }

    document.addEventListener('click', trackLandingCta)
    return () => document.removeEventListener('click', trackLandingCta)
  }, [])

  return null
}
