import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedBatches, seedClaims, seedConflicts, seedVersions } from '../data/seed'
import { applyBatch, computePublishBlockers, hashBatchContent, recomputeConfidence } from '../services/offlineMerge'
import type { AuditEntry, BatchRecord, Claim, ClaimAnnotation, ClaimFact, ConclusionConflict, FactConclusion, OfflineBatch, SourceRecord, VersionRecord } from '../types'

export interface MergeSummary {
  merged: string[]
  duplicated: string[]
  failed: string[]
  conflicts: string[]
}

interface ClaimState {
  claims: Claim[]
  versions: VersionRecord[]
  audit: AuditEntry[]
  batches: BatchRecord[]
  conflicts: ConclusionConflict[]
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
  submitBatches: (claimId: string, batches: OfflineBatch[], simulateFailures?: string[]) => MergeSummary
  retryBatch: (batchId: string) => { ok: boolean; message: string }
  resolveConflict: (conflictId: string, keep: 'current' | 'incoming', resolution: string) => void
  transitionClaim: (claimId: string, status: Claim['status'], note: string) => { ok: boolean; message: string }
  reset: () => void
}

let idSeed = 100
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`

export const useClaimStore = create<ClaimState>()(persist((set, get) => {
  /** 应用单个批次并落库:重算置信度、生成版本记录。任何失败都会抛错,由调用方保留批次待重试 */
  const commitBatch = (record: BatchRecord): { conflictIds: string[] } => {
    const state = get()
    const claim = state.claims.find((item) => item.id === record.claimId)
    if (!claim) throw new Error('主张不存在')
    const now = new Date().toISOString()
    const result = applyBatch(claim, record, now, nextId)
    const conflicts = [...state.conflicts, ...result.conflicts]
    // 合并后按当前全部证据重算置信度,不沿用离线批次携带的结果
    const facts = result.facts.map((fact) => ({
      ...fact,
      confidence: recomputeConfidence(fact, conflicts.some((item) => item.claimId === claim.id && item.factId === fact.id && item.status === '待裁定'))
    }))
    const version = claim.version + 1
    const versionRecord: VersionRecord = {
      id: nextId('V'), claimId: claim.id, version, editor: record.author,
      summary: `离线合并批次 ${record.id}(${record.ops.length} 项操作)`,
      changedFactIds: [...new Set(record.ops.map((op) => op.factId))], removedEvidence: [], createdAt: now,
      mergedBatchIds: [record.id], conflictIds: result.conflicts.map((item) => item.id)
    }
    set((current) => ({
      claims: current.claims.map((item) => (item.id === claim.id ? { ...item, facts, version, updatedAt: now } : item)),
      conflicts: [...current.conflicts, ...result.conflicts],
      versions: [versionRecord, ...current.versions],
      batches: current.batches.map((item) => (item.id === record.id ? { ...item, status: '已合并' as const, mergedAt: now, mergedVersion: version, effects: result.effects, lastError: undefined } : item)),
      audit: [audit(claim.id, '合并离线批次', record.author, `${record.id}:${result.effects.length} 项变更${result.conflicts.length ? `,${result.conflicts.length} 起结论冲突` : ''}`), ...current.audit]
    }))
    return { conflictIds: result.conflicts.map((item) => item.id) }
  }
  const failBatch = (batchId: string, author: string, message: string) => set((current) => ({
    batches: current.batches.map((item) => (item.id === batchId ? { ...item, status: '写入失败' as const, lastError: message } : item)),
    audit: [audit(current.batches.find((item) => item.id === batchId)?.claimId ?? '', '离线批次写入失败', author, `${batchId}:${message},批次保留待重试`), ...current.audit]
  }))
  return {
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
      return { claims: [...state.claims], audit: [audit(claimId, '更新事实结论', '当前用户', `${fact.text}:${fact.conclusion}`), ...state.audit] }
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
    submitBatches: (claimId, incoming, simulateFailures = []) => {
      const summary: MergeSummary = { merged: [], duplicated: [], failed: [], conflicts: [] }
      for (const batch of incoming) {
        const state = get()
        if (!state.claims.some((item) => item.id === claimId)) { summary.failed.push(batch.id); continue }
        const contentHash = batch.contentHash || hashBatchContent(batch)
        // 幂等:批次号相同或内容哈希相同的批次只处理一次
        const prior = state.batches.find((item) => item.claimId === claimId && item.status !== '重复跳过' && (item.id === batch.id || (item.contentHash && item.contentHash === contentHash)))
        if (prior && prior.status === '写入失败') {
          const result = get().retryBatch(prior.id)
          if (result.ok) { summary.merged.push(prior.id) } else { summary.failed.push(prior.id) }
          continue
        }
        if (prior) {
          set((current) => ({
            batches: [{ ...batch, contentHash, status: '重复跳过' as const, attempts: 0, effects: [`与批次 ${prior.id} 相同(批次号或内容哈希一致),仅处理一次`] }, ...current.batches],
            audit: [audit(claimId, '重复批次跳过', batch.author, `${batch.id} 与 ${prior.id} 相同,已归并不再重复应用`), ...current.audit]
          }))
          summary.duplicated.push(batch.id)
          continue
        }
        const record: BatchRecord = { ...batch, contentHash, status: '待写入', attempts: 1, effects: [] }
        set((current) => ({ batches: [record, ...current.batches] }))
        if (simulateFailures.includes(batch.id)) {
          failBatch(record.id, batch.author, '模拟写入失败:存储不可用')
          summary.failed.push(batch.id)
          continue
        }
        try {
          const result = commitBatch(record)
          summary.merged.push(record.id)
          summary.conflicts.push(...result.conflictIds)
        } catch (error) {
          failBatch(record.id, batch.author, error instanceof Error ? error.message : String(error))
          summary.failed.push(batch.id)
        }
      }
      return summary
    },
    retryBatch: (batchId) => {
      const record = get().batches.find((item) => item.id === batchId)
      if (!record) return { ok: false, message: '批次不存在' }
      if (record.status !== '写入失败') return { ok: false, message: '仅写入失败的批次需要重试' }
      set((current) => ({ batches: current.batches.map((item) => (item.id === batchId ? { ...item, status: '待写入' as const, attempts: item.attempts + 1 } : item)) }))
      try {
        commitBatch(record)
        return { ok: true, message: `批次 ${batchId} 重试成功,已合并为新版本` }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set((current) => ({ batches: current.batches.map((item) => (item.id === batchId ? { ...item, status: '写入失败' as const, lastError: message } : item)) }))
        return { ok: false, message: `重试失败:${message},批次仍保留` }
      }
    },
    resolveConflict: (conflictId, keep, resolution) => set((state) => {
      const conflict = state.conflicts.find((item) => item.id === conflictId)
      if (!conflict || conflict.status !== '待裁定') return state
      const claim = state.claims.find((item) => item.id === conflict.claimId)
      if (!claim) return state
      const now = new Date().toISOString()
      const chosen = keep === 'incoming' ? conflict.incoming.conclusion : conflict.current.conclusion
      const facts = claim.facts.map((fact) => {
        if (fact.id !== conflict.factId) return fact
        const next = { ...fact, conclusion: chosen }
        // 裁定后同样按当前全部证据重算置信度
        return { ...next, confidence: recomputeConfidence(next, false) }
      })
      const version = claim.version + 1
      const versionRecord: VersionRecord = {
        id: nextId('V'), claimId: claim.id, version, editor: claim.editor || '当前用户',
        summary: `裁定结论冲突 ${conflictId}:「${conflict.current.conclusion}」⇄「${conflict.incoming.conclusion}」,采用「${chosen}」`,
        changedFactIds: [conflict.factId], removedEvidence: [], createdAt: now, mergedBatchIds: [], conflictIds: [conflictId]
      }
      return {
        claims: state.claims.map((item) => (item.id === claim.id ? { ...item, facts, version, updatedAt: now } : item)),
        conflicts: state.conflicts.map((item) => (item.id === conflictId ? { ...item, status: '已裁定' as const, resolution: `${resolution || '编辑裁定'},采用「${chosen}」` } : item)),
        versions: [versionRecord, ...state.versions],
        audit: [audit(claim.id, '裁定结论冲突', '当前用户', `${conflict.factId} 采用「${chosen}」:${resolution || '编辑裁定'}`), ...state.audit]
      }
    }),
    transitionClaim: (claimId, status, note) => {
      const state = get()
      const claim = state.claims.find((item) => item.id === claimId)
      if (!claim) return { ok: false, message: '主张不存在' }
      if (status === '待编辑复核' && claim.facts.length === 0) return { ok: false, message: '至少需要一项可验证事实' }
      if (status === '已发布') {
        // 发布阻断按当前全部证据与冲突实时重算
        const blockers = computePublishBlockers(claim, state.conflicts)
        if (blockers.length) return { ok: false, message: `发布被阻断:${blockers[0]}${blockers.length > 1 ? ` 等 ${blockers.length} 项` : ''}` }
        if (!claim.editor) return { ok: false, message: '缺少编辑复核人' }
      }
      claim.status = status
      claim.version += 1
      claim.updatedAt = new Date().toISOString()
      const version: VersionRecord = { id: nextId('V'), claimId, version: claim.version, editor: claim.editor || '当前用户', summary: note, changedFactIds: [], removedEvidence: [], createdAt: claim.updatedAt }
      set((current) => ({ claims: [...current.claims], versions: [version, ...current.versions], audit: [audit(claimId, `状态流转:${status}`, '当前用户', note), ...current.audit] }))
      return { ok: true, message: `已流转至${status}` }
    },
    reset: () => set({ claims: structuredClone(seedClaims), versions: structuredClone(seedVersions), audit: structuredClone(seedAudit), batches: structuredClone(seedBatches), conflicts: structuredClone(seedConflicts), keyword: '', status: '全部' })
  }
}, { name: 'gsb68:fact-check-workbench' }))

function audit(claimId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), claimId, action, operator, detail, createdAt: new Date().toISOString() }
}

export const conclusionColor: Record<FactConclusion, string> = {
  已证实: 'green',
  部分属实: 'yellow',
  证据不足: 'orange',
  不实: 'red'
}

export const batchStatusColor: Record<BatchRecord['status'], string> = {
  待写入: 'blue',
  已合并: 'green',
  重复跳过: 'gray',
  写入失败: 'red'
}
