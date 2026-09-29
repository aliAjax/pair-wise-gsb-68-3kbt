import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedBatches, seedClaims, seedConflicts, seedVersions } from '../data/seed'
import { computePublishBlocks, mergeOfflineBatches } from '../lib/merge'
import type { AuditEntry, Claim, ClaimAnnotation, ClaimFact, FactConclusion, MergeConflict, OfflineBatch, SourceRecord, VersionRecord } from '../types'

interface ClaimState {
  claims: Claim[]
  versions: VersionRecord[]
  audit: AuditEntry[]
  batches: OfflineBatch[]
  conflicts: MergeConflict[]
  keyword: string
  status: Claim['status'] | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: Claim['status'] | '全部') => void
  addClaim: (input: { title: string; summary: string; reporter: string; priority: Claim['priority'] }) => Claim
  updateFact: (claimId: string, factId: string, patch: Partial<ClaimFact>) => void
  addFact: (claimId: string, text: string) => void
  addAnnotation: (claimId: string, factId: string, annotation: Omit<ClaimAnnotation, 'id' | 'createdAt' | 'resolved'>) => void
  resolveAnnotation: (claimId: string, factId: string, annotationId: string) => void
  addSource: (claimId: string, factId: string, source: Omit<SourceRecord, 'id' | 'capturedAt' | 'version'>, counter: boolean) => void
  importOfflineBatches: (claimId: string, batches: OfflineBatch[]) => { ok: boolean; message: string; applied: number; failed: number; duplicates: number; conflicts: number }
  retryOfflineBatch: (claimId: string, batchId: string) => { ok: boolean; message: string }
  resolveMergeConflict: (claimId: string, conflictId: string) => void
  transitionClaim: (claimId: string, status: Claim['status'], note: string) => { ok: boolean; message: string }
  reset: () => void
}

let idSeed = 100
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`

export const useClaimStore = create<ClaimState>()(persist((set, get) => ({
  claims: seedClaims,
  versions: seedVersions,
  audit: seedAudit,
  batches: seedBatches,
  conflicts: seedConflicts,
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),
  addClaim: (input) => {
    const now = new Date().toISOString()
    const claim: Claim = { id: nextId('FC'), ...input, editor: '宋卓', status: '核查中', createdAt: now, updatedAt: now, version: 1, facts: [] }
    set((state) => ({ claims: [claim, ...state.claims], audit: [audit(claim.id, '建立核查主张', input.reporter, input.summary), ...state.audit] }))
    return claim
  },
  addFact: (claimId, text) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim || !text.trim()) return state
    claim.facts.push({ id: nextId('F'), text, conclusion: '证据不足', confidence: 30, unresolved: ['尚未关联来源'], sources: [], counterSources: [], annotations: [] })
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    return { claims: [...state.claims], audit: [audit(claimId, '拆分可验证事实', claim.reporter, text), ...state.audit] }
  }),
  updateFact: (claimId, factId, patch) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact) return state
    if (patch.conclusion && patch.conclusion !== '证据不足' && fact.unresolved.length) {
      patch.confidence = Math.min(patch.confidence ?? fact.confidence, 75)
    }
    Object.assign(fact, patch)
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    return { claims: [...state.claims], audit: [audit(claimId, '更新事实结论', '当前用户', `${fact.text}：${fact.conclusion}`), ...state.audit] }
  }),
  addAnnotation: (claimId, factId, input) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact) return state
    fact.annotations.unshift({ ...input, id: nextId('N'), createdAt: new Date().toISOString(), resolved: false })
    return { claims: [...state.claims], audit: [audit(claimId, '添加批注', input.author, input.content), ...state.audit] }
  }),
  resolveAnnotation: (claimId, factId, annotationId) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const annotation = claim?.facts.find((item) => item.id === factId)?.annotations.find((item) => item.id === annotationId)
    if (!claim || !annotation) return state
    annotation.resolved = true
    return { claims: [...state.claims], audit: [audit(claimId, '解决批注', '当前用户', annotation.content), ...state.audit] }
  }),
  addSource: (claimId, factId, input, counter) => set((state) => {
    const claim = state.claims.find((item) => item.id === claimId)
    const fact = claim?.facts.find((item) => item.id === factId)
    if (!claim || !fact) return state
    const list = counter ? fact.counterSources : fact.sources
    const sameTitle = list.filter((item) => item.title === input.title).length
    const source: SourceRecord = { ...input, id: nextId(counter ? 'C' : 'S'), capturedAt: new Date().toISOString(), version: sameTitle + 1 }
    list.unshift(source)
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    return { claims: [...state.claims], audit: [audit(claimId, counter ? '保留相反证据' : '关联来源', '当前用户', input.title), ...state.audit] }
  }),
  importOfflineBatches: (claimId, input) => {
    const state = get()
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim) return { ok: false, message: '主张不存在', applied: 0, failed: 0, duplicates: 0, conflicts: 0 }
    const now = new Date().toISOString()
    // 重复批次只处理一次：按批次 id 与内容哈希对已入库批次去重。
    const knownIds = new Set((state.batches ?? []).map((item) => item.id))
    const knownHashes = new Set((state.batches ?? []).map((item) => item.contentHash))
    const seenInInput = new Set<string>()
    const fresh: OfflineBatch[] = []
    const duplicates: string[] = []
    for (const batch of input) {
      if (knownIds.has(batch.id) || knownHashes.has(batch.contentHash) || seenInInput.has(batch.id) || seenInInput.has(batch.contentHash)) {
        duplicates.push(batch.id)
        continue
      }
      seenInInput.add(batch.id)
      seenInInput.add(batch.contentHash)
      fresh.push(batch)
    }
    const output = mergeOfflineBatches({ claim, batches: fresh, conflicts: state.conflicts ?? [], duplicates, now, operator: '陆衡' })
    set((current) => ({
      claims: current.claims.map((item) => (item.id === claimId ? output.claim : item)),
      batches: mergeBatchRecords(current.batches ?? [], output.batches),
      conflicts: [...output.conflicts, ...(current.conflicts ?? [])],
      versions: [output.version, ...current.versions],
      audit: [...output.audit.map((item) => audit(claimId, item.action, '陆衡', item.detail)), ...current.audit],
    }))
    const applied = output.batches.filter((item) => item.status === '已应用').length
    const failed = output.batches.filter((item) => item.status === '失败').length
    return { ok: true, message: `合并完成：应用 ${applied} 批，跳过重复 ${duplicates.length} 批，失败待重试 ${failed} 批`, applied, failed, duplicates: duplicates.length, conflicts: output.conflicts.length }
  },
  retryOfflineBatch: (claimId, batchId) => {
    const state = get()
    const claim = state.claims.find((item) => item.id === claimId)
    const stored = (state.batches ?? []).find((item) => item.id === batchId && item.claimId === claimId)
    if (!claim || !stored) return { ok: false, message: '批次不存在' }
    if (stored.status === '已应用') return { ok: false, message: '批次已应用，无需重试' }
    const now = new Date().toISOString()
    const output = mergeOfflineBatches({
      claim,
      batches: [{ ...stored, status: '待处理', failReason: undefined }],
      conflicts: state.conflicts ?? [],
      duplicates: [],
      now,
      operator: '陆衡',
    })
    const retried = output.batches[0]
    set((current) => ({
      claims: current.claims.map((item) => (item.id === claimId ? output.claim : item)),
      batches: mergeBatchRecords(current.batches ?? [], output.batches),
      conflicts: [...output.conflicts, ...(current.conflicts ?? [])],
      versions: [output.version, ...current.versions],
      audit: [...output.audit.map((item) => audit(claimId, item.action, '陆衡', item.detail)), ...current.audit],
    }))
    return retried.status === '已应用'
      ? { ok: true, message: `批次 ${batchId} 重试成功，已合并入档案` }
      : { ok: false, message: `批次 ${batchId} 仍失败：${retried.failReason}` }
  },
  resolveMergeConflict: (claimId, conflictId) => set((state) => ({
    conflicts: (state.conflicts ?? []).map((item) => (item.id === conflictId ? { ...item, resolved: true } : item)),
    audit: [audit(claimId, '解决结论冲突', '陆衡', `冲突 ${conflictId} 已标记解决，发布阻断解除`), ...state.audit],
  })),
  transitionClaim: (claimId, status, note) => {
    const state = get()
    const claim = state.claims.find((item) => item.id === claimId)
    if (!claim) return { ok: false, message: '主张不存在' }
    if (status === '待编辑复核' && claim.facts.length === 0) return { ok: false, message: '至少需要一项可验证事实' }
    if (status === '已发布') {
      // 发布阻断按当前全部证据与未解决冲突重算，不沿用离线结果。
      const blocks = computePublishBlocks(claim, state.conflicts ?? [])
      if (blocks.length) return { ok: false, message: `发布前校验未通过：${blocks[0]}` }
    }
    claim.status = status
    claim.version += 1
    claim.updatedAt = new Date().toISOString()
    const version: VersionRecord = { id: nextId('V'), claimId, version: claim.version, editor: claim.editor || '当前用户', summary: note, changedFactIds: [], removedEvidence: [], createdAt: claim.updatedAt }
    set((current) => ({ claims: [...current.claims], versions: [version, ...current.versions], audit: [audit(claimId, `状态流转：${status}`, '当前用户', note), ...current.audit] }))
    return { ok: true, message: `已流转至${status}` }
  },
  reset: () => set({ claims: structuredClone(seedClaims), versions: structuredClone(seedVersions), audit: structuredClone(seedAudit), batches: structuredClone(seedBatches), conflicts: structuredClone(seedConflicts), keyword: '', status: '全部' })
}), { name: 'gsb68:fact-check-workbench' }))

function mergeBatchRecords(existing: OfflineBatch[], updated: OfflineBatch[]): OfflineBatch[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const batch of updated) byId.set(batch.id, batch)
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function audit(claimId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), claimId, action, operator, detail, createdAt: new Date().toISOString() }
}

export const conclusionColor: Record<FactConclusion, string> = {
  已证实: 'green',
  部分属实: 'yellow',
  证据不足: 'orange',
  不实: 'red'
}
