'use client'

import { useState, useEffect } from 'react'
import { createClient } from './supabase'

export function useRole() {
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const supabase = createClient()

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
        .select('role')
        .eq('id', authUser.id)
        .single()

      setRole(profile?.role || 'viewer')
      setLoading(false)
    }

    fetchRole()
  }, [])

  const isAdmin = role === 'admin'
  const isManager = role === 'admin' || role === 'manager'
  const isEditor = role === 'admin' || role === 'manager' || role === 'editor'
  const isViewer = true // everyone can view

  return { role, loading, user, isAdmin, isManager, isEditor, isViewer }
}