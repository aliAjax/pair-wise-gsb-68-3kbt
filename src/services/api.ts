import axios from 'axios'
import type { Claim, ConclusionConflict } from '../types'
import { computePublishBlockers } from './offlineMerge'

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 5000 })

export async function loadClaimSnapshot(fallback: Claim[]): Promise<Claim[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try { return (await client.get<Claim[]>('/claims')).data } catch { return fallback }
}

export async function preflightPublish(claim: Claim, conflicts: ConclusionConflict[] = []) {
  const blocking = computePublishBlockers(claim, conflicts)
  return { allowed: blocking.length === 0, blocking }
}
