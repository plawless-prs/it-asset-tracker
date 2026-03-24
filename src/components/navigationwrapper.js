'use client'

import { usePathname } from 'next/navigation'
import Navigation from './navigation'

export default function navigationwrapper() {
  const pathname = usePathname()

  // Don't show navigation on the login page
  if (pathname === '/login') return null

  return <Navigation />
}