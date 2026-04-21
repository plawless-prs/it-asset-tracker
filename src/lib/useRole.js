'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export function useRole() {
  const [role, setRole] = useState(null)
  const [user, setUser] = useState(null)
  const [appAccess, setAppAccess] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRole() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        setLoading(false)
        return
      }
      setUser(authUser)

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, app_access')
        .eq('id', authUser.id)
        .single()

      if (profile) {
        setRole(profile.role)
        setAppAccess(profile.app_access || ['tracker', 'invoices', 'calculator'])
      }
      setLoading(false)
    }
    fetchRole()
  }, [])

  const isAdmin = role === 'admin'
  const isManager = role === 'admin' || role === 'manager'
  const isEditor = role === 'admin' || role === 'manager' || role === 'editor'
  const hasAccess = (appId) => isAdmin || appAccess.includes(appId)

  return { role, isAdmin, isManager, isEditor, user, loading, appAccess, hasAccess }
}