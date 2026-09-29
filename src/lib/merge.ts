import type { Claim, ClaimFact, FactConclusion, MergeConflict, OfflineBatch, SourceRecord, VersionRecord } from '../types'

// ---------- 内容哈希 ----------
// 批次内容哈希：同一批记录内容完全一致则归并，重复批次只处理一次。
export function hashBatchContent(operations: unknown): string {
  const text = JSON.stringify(operations)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `batch:${(h >>> 0).toString(16).padStart(8, '0')}`
}

let opSeq = 0
export function nextMergeId(prefix: string): string {
  opSeq += 1
  return `${prefix}-OFF-${opSeq}`
}

// ---------- 置信度重算 ----------
// 合并后按当前全部证据重算事实置信度，不沿用离线端给出的置信度。
export function recomputeConfidence(fact: ClaimFact): number {
  let score = 24
  for (const source of fact.sources) {
    score += source.kind === '原始证据' ? 16 : source.kind === '二次来源' ? 9 : 4
  }
  for (const source of fact.counterSources) {
    score -= source.kind === '原始证据' ? 15 : source.kind === '二次来源' ? 8 : 3
  }
  score -= fact.unresolved.length * 7
  score -= fact.annotations.filter((item) => !item.resolved).length * 4
  if (fact.conclusion === '证据不足') score = Math.min(score, 45)
  if (fact.conclusion === '不实' && fact.counterSources.length > 0) score = Math.min(score, 92)
  if (fact.conclusion === '已证实' && fact.counterSources.length === 0 && fact.unresolved.length === 0) score = Math.max(score, 80)
  return Math.max(5, Math.min(98, Math.round(score)))
}

// ---------- 发布阻断重算 ----------
// 发布阻断按当前全部证据与未解决冲突重算，不沿用离线端结果。
export function computePublishBlocks(claim: Claim, conflicts: MergeConflict[] = []): string[] {
  const blocks: string[] = []
  if (claim.facts.some((fact) => fact.conclusion === '证据不足' && fact.unresolved.length)) {
    blocks.push('仍有证据不足且未解决疑点的事实')
  }
  if (claim.facts.some((fact) => fact.sources.length + fact.counterSources.length === 0)) {
    blocks.push('存在没有来源记录的事实')
  }
  if (claim.facts.flatMap((fact) => fact.sources).some((source) => source.kind === '待证信息')) {
    blocks.push('待证信息尚未完成原始来源核验')
  }
  if (claim.facts.some((fact) => fact.annotations.some((annotation) => !annotation.resolved))) {
    blocks.push('存在未解决的事实核查批注')
  }
  const openConflicts = conflicts.filter((item) => item.claimId === claim.id && !item.resolved)
  if (openConflicts.length) {
    const factIds = [...new Set(openConflicts.map((item) => item.factId))].join('、')
    blocks.push(`存在 ${openConflicts.length} 项未解决的结论冲突（事实 ${factIds}）`)
  }
  return blocks
}

// ---------- 离线批次合并 ----------
export interface MergeInput {
  claim: Claim
  batches: OfflineBatch[]
  conflicts: MergeConflict[]
  duplicates: string[]
  now: string
  operator: string
}

export interface MergeAudit {
  action: string
  detail: string
}

export interface MergeOutput {
  claim: Claim
  batches: OfflineBatch[]
  conflicts: MergeConflict[]
  version: VersionRecord
  audit: MergeAudit[]
  duplicates: string[]
}

interface ApplyCtx {
  now: string
  seq: number
  proposals: Map<string, ConclusionProposalLike[]>
  seenHashes: Set<string>
  withdrawnTitles: string[]
  touchedFactIds: Set<string>
  newConflicts: MergeConflict[]
  existingConflicts: MergeConflict[]
  audit: MergeAudit[]
}

interface ConclusionProposalLike {
  conclusion: FactConclusion
  batchId: string
  inspector: string
  at: string
}

export function mergeOfflineBatches(input: MergeInput): MergeOutput {
  const draft = structuredClone(input.claim)
  const ctx: ApplyCtx = {
    now: input.now,
    seq: 0,
    proposals: new Map(),
    seenHashes: new Set(),
    withdrawnTitles: [],
    touchedFactIds: new Set(),
    newConflicts: [],
    existingConflicts: input.conflicts,
    audit: [],
  }
  const applied: OfflineBatch[] = []
  const failed: OfflineBatch[] = []

  for (const batch of input.batches) {
    // 重复批次只处理一次：已应用的批次直接跳过。
    if (batch.status === '已应用') continue
    const result = applyBatch(draft, batch, ctx)
    if (result.ok) applied.push(result.batch)
    else failed.push(result.batch)
  }

  // 合并后按当前全部证据重算受影响事实的置信度，不沿用离线结果。
  for (const factId of ctx.touchedFactIds) {
    const fact = draft.facts.find((item) => item.id === factId)
    if (fact) fact.confidence = recomputeConfidence(fact)
  }

  const appliedIds = applied.map((item) => item.id)
  const conflictIds = ctx.newConflicts.map((item) => item.id)
  draft.version += 1
  draft.updatedAt = input.now
  const version: VersionRecord = {
    id: nextMergeId('V'),
    claimId: draft.id,
    version: draft.version,
    editor: input.operator,
    summary: `离线批次合并：已应用 ${applied.length} 批${failed.length ? `，失败待重试 ${failed.length} 批` : ''}${ctx.newConflicts.length ? `，新增结论冲突 ${ctx.newConflicts.length} 项` : ''}`,
    changedFactIds: [...ctx.touchedFactIds],
    removedEvidence: ctx.withdrawnTitles,
    createdAt: input.now,
    mergedBatchIds: appliedIds,
    conflictIds,
  }

  ctx.audit.unshift({
    action: '离线批次合并',
    detail: `应用 ${applied.length} 批 / 跳过重复 ${input.duplicates.length} 批 / 失败待重试 ${failed.length} 批 / 新增冲突 ${ctx.newConflicts.length} 项`,
  })

  return {
    claim: draft,
    batches: [...applied, ...failed],
    conflicts: ctx.newConflicts,
    version,
    audit: ctx.audit,
    duplicates: input.duplicates,
  }
}

function applyBatch(draft: Claim, batch: OfflineBatch, ctx: ApplyCtx): { ok: boolean; batch: OfflineBatch } {
  const updated: OfflineBatch = { ...batch }
  // 整批校验：任一操作不成立则整批失败，保留批次待重试，已成功批次不受影响。
  const validation = validateBatch(draft, batch)
  if (!validation.ok) {
    updated.status = '失败'
    updated.failReason = validation.error
    ctx.audit.push({ action: '批次写入失败', detail: `${batch.id}：${validation.error}` })
    return { ok: false, batch: updated }
  }
  for (const op of batch.operations) {
    if (op.kind === '证据修改') applyEvidence(draft, batch, op, ctx)
    else if (op.kind === '证据撤回') applyWithdraw(draft, op, ctx)
    else applyAnnotation(draft, op, ctx)
  }
  for (const op of batch.operations) {
    if (op.kind === '证据修改' && op.conclusion) registerProposal(draft, batch, op, ctx)
  }
  updated.status = '已应用'
  updated.failReason = undefined
  updated.appliedAt = ctx.now
  updated.appliedVersion = draft.version + 1
  ctx.audit.push({ action: '应用离线批次', detail: `${batch.id}（${batch.inspector}）：${summarizeOps(batch)}` })
  return { ok: true, batch: updated }
}

function validateBatch(draft: Claim, batch: OfflineBatch): { ok: boolean; error?: string } {
  for (const op of batch.operations) {
    const fact = draft.facts.find((item) => item.id === op.factId)
    if (!fact) return { ok: false, error: `事实不存在：${op.factId}` }
    if (op.kind === '证据撤回' && !findSource(fact, op)) {
      return { ok: false, error: `撤回目标不存在：${op.sourceId ?? op.contentHash ?? '未指定目标'}` }
    }
    if (op.kind === '批注处理' && op.mode === '解决') {
      const annotation = fact.annotations.find((item) => item.id === op.annotationId)
      if (!annotation) return { ok: false, error: `批注不存在：${op.annotationId}` }
      if (annotation.resolved) return { ok: false, error: `批注已解决，无需重复处理：${op.annotationId}` }
    }
  }
  return { ok: true }
}

function findSource(fact: ClaimFact, op: { sourceId?: string; contentHash?: string }): SourceRecord | undefined {
  const all = [...fact.sources, ...fact.counterSources]
  if (op.sourceId) return all.find((item) => item.id === op.sourceId)
  if (op.contentHash) return all.find((item) => item.contentHash === op.contentHash)
  return undefined
}

function applyEvidence(draft: Claim, batch: OfflineBatch, op: Extract<BatchOperationLike, { kind: '证据修改' }>, ctx: ApplyCtx): void {
  const fact = draft.facts.find((item) => item.id === op.factId)!
  const list = op.counter ? fact.counterSources : fact.sources
  // 内容哈希相同就归并：本批或既有证据中已存在同哈希来源则不重复写入。
  if (ctx.seenHashes.has(op.source.contentHash) || list.some((item) => item.contentHash === op.source.contentHash)) {
    ctx.audit.push({ action: '证据哈希归并', detail: `${op.source.title}（${op.source.contentHash}）与既有证据哈希相同，归并不重复写入` })
    ctx.touchedFactIds.add(fact.id)
    return
  }
  const sameTitle = list.filter((item) => item.title === op.source.title).length
  const source: SourceRecord = {
    ...op.source,
    id: `${op.counter ? 'C' : 'S'}-OFF-${++ctx.seq}`,
    capturedAt: ctx.now,
    version: sameTitle + 1,
  }
  list.unshift(source)
  ctx.seenHashes.add(op.source.contentHash)
  ctx.touchedFactIds.add(fact.id)
}

function applyWithdraw(draft: Claim, op: Extract<BatchOperationLike, { kind: '证据撤回' }>, ctx: ApplyCtx): void {
  const fact = draft.facts.find((item) => item.id === op.factId)!
  const source = findSource(fact, op)
  if (!source) return
  const list = fact.counterSources.some((item) => item.id === source.id) ? fact.counterSources : fact.sources
  list.splice(list.findIndex((item) => item.id === source.id), 1)
  ctx.withdrawnTitles.push(source.title)
  ctx.touchedFactIds.add(fact.id)
  ctx.audit.push({ action: '撤回证据', detail: `${source.title}（${source.contentHash}）：${op.reason}` })
}

function applyAnnotation(draft: Claim, op: Extract<BatchOperationLike, { kind: '批注处理' }>, ctx: ApplyCtx): void {
  const fact = draft.facts.find((item) => item.id === op.factId)!
  if (op.mode === '添加') {
    fact.annotations.unshift({
      id: `N-OFF-${++ctx.seq}`,
      author: op.annotation.author,
      role: op.annotation.role,
      content: op.annotation.content,
      createdAt: ctx.now,
      resolved: false,
    })
  } else {
    const annotation = fact.annotations.find((item) => item.id === op.annotationId)
    if (annotation) annotation.resolved = true
  }
  ctx.touchedFactIds.add(fact.id)
}

function registerProposal(draft: Claim, batch: OfflineBatch, op: Extract<BatchOperationLike, { kind: '证据修改' }>, ctx: ApplyCtx): void {
  if (!op.conclusion) return
  const fact = draft.facts.find((item) => item.id === op.factId)!
  const prior = ctx.proposals.get(fact.id) ?? []
  const proposal: ConclusionProposalLike = { conclusion: op.conclusion, batchId: batch.id, inspector: batch.inspector, at: ctx.now }
  const distinct = new Set<FactConclusion>([fact.conclusion, ...prior.map((item) => item.conclusion), op.conclusion])
  if (distinct.size <= 1) {
    ctx.proposals.set(fact.id, [...prior, proposal])
    return
  }
  // 结论冲突：离线结论仅作为提案与当前结论同时保留，不覆盖当前结论，并阻止发布。
  const hasOpenConflict = [...ctx.existingConflicts, ...ctx.newConflicts].some((item) => item.factId === fact.id && !item.resolved)
  if (hasOpenConflict) {
    ctx.audit.push({ action: '结论冲突', detail: `事实 ${fact.id}：已有未解决结论冲突，离线结论 ${op.conclusion}（${batch.id}）同时保留，仍阻止发布` })
    ctx.proposals.set(fact.id, [...prior, proposal])
    return
  }
  const sides: ConclusionProposalLike[] = [
    { conclusion: fact.conclusion, batchId: '当前结论', inspector: draft.reporter, at: draft.updatedAt },
    ...prior,
    proposal,
  ]
  const seen = new Set<FactConclusion>()
  const proposals = sides.filter((item) => (seen.has(item.conclusion) ? false : (seen.add(item.conclusion), true)))
  const conflict: MergeConflict = {
    id: nextMergeId('MC'),
    claimId: draft.id,
    factId: fact.id,
    type: '结论冲突',
    proposals,
    detectedAt: ctx.now,
    resolved: false,
  }
  ctx.newConflicts.push(conflict)
  ctx.proposals.set(fact.id, [...prior, proposal])
  const conclusions = [...new Set([fact.conclusion, ...prior.map((item) => item.conclusion), op.conclusion])].join(' vs ')
  const batchIds = [...new Set([...prior.map((item) => item.batchId), batch.id])].join('、')
  ctx.audit.push({ action: '结论冲突', detail: `事实 ${fact.id}：${conclusions}（批次 ${batchIds}），双方结论同时保留，阻止发布` })
}

function summarizeOps(batch: OfflineBatch): string {
  const parts: string[] = []
  const evidence = batch.operations.filter((item) => item.kind === '证据修改').length
  const withdraw = batch.operations.filter((item) => item.kind === '证据撤回').length
  const annotation = batch.operations.filter((item) => item.kind === '批注处理').length
  if (evidence) parts.push(`证据修改 ${evidence}`)
  if (withdraw) parts.push(`证据撤回 ${withdraw}`)
  if (annotation) parts.push(`批注处理 ${annotation}`)
  return parts.join('，')
}

// 仅用于类型推导，避免在函数签名中重复书写联合类型。
type BatchOperationLike = OfflineBatch['operations'][number]
