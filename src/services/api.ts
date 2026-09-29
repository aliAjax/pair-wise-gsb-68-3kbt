import axios from 'axios'
import { computePublishBlocks } from '../lib/merge'
import type { Claim, MergeConflict } from '../types'

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 5000 })

export async function loadClaimSnapshot(fallback: Claim[]): Promise<Claim[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try { return (await client.get<Claim[]>('/claims')).data } catch { return fallback }
}

// 发布阻断按当前全部证据与未解决冲突重算，不沿用离线端给出的阻断结论。
export async function preflightPublish(claim: Claim, conflicts: MergeConflict[] = []) {
  const blocking = computePublishBlocks(claim, conflicts)
  return { allowed: blocking.length === 0, blocking }
}
