import type { BatchOperation, Claim, ClaimFact, ConclusionConflict, FactConclusion, OfflineBatch, SourceRecord } from '../types'

/** 批次内容哈希(FNV-1a,确定性):只对内容字段取哈希,批次号、设备等元数据不影响归并 */
export function hashBatchContent(input: Pick<OfflineBatch, 'claimId' | 'author' | 'createdOfflineAt' | 'note' | 'ops'>): string {
  const text = JSON.stringify({ claimId: input.claimId, author: input.author, createdOfflineAt: input.createdOfflineAt, note: input.note, ops: input.ops })
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

const KIND_SCORE: Record<SourceRecord['kind'], number> = { 原始证据: 22, 二次来源: 10, 待证信息: 3 }
const COUNTER_PENALTY: Record<SourceRecord['kind'], number> = { 原始证据: 18, 二次来源: 8, 待证信息: 2 }

/**
 * 按当前全部证据重算事实置信度。合并后必须调用,不得沿用离线批次携带的数值。
 * 规则:基础 15;未撤回支持来源加分(原始>二次>待证);未撤回相反来源扣分;
 * 未解决疑点/批注扣分;存在待裁定结论冲突扣分;无任何来源时封顶 40。
 */
export function recomputeConfidence(fact: ClaimFact, hasOpenConflict: boolean): number {
  const active = (list: SourceRecord[]) => list.filter((source) => !source.retracted)
  let score = 15
  for (const source of active(fact.sources)) score += KIND_SCORE[source.kind]
  for (const source of active(fact.counterSources)) score -= COUNTER_PENALTY[source.kind]
  score -= fact.unresolved.length * 7
  score -= fact.annotations.filter((note) => !note.resolved).length * 5
  if (hasOpenConflict) score -= 15
  const total = active(fact.sources).length + active(fact.counterSources).length
  if (total === 0) score = Math.min(score, 40)
  return Math.max(0, Math.min(100, Math.round(score)))
}

/** 按当前全部证据与冲突重算发布阻断,每次发布校验都重新计算 */
export function computePublishBlockers(claim: Claim, conflicts: ConclusionConflict[]): string[] {
  const blockers: string[] = []
  for (const fact of claim.facts) {
    if (fact.conclusion === '证据不足' && fact.unresolved.length) blockers.push(`${fact.id} 证据不足且存在未解决疑点`)
    if (fact.sources.length + fact.counterSources.length === 0) blockers.push(`${fact.id} 没有任何来源记录`)
    if ([...fact.sources, ...fact.counterSources].some((source) => source.kind === '待证信息' && !source.retracted)) blockers.push(`${fact.id} 待证信息未完成原始来源核验`)
  }
  for (const conflict of conflicts.filter((item) => item.claimId === claim.id && item.status === '待裁定')) {
    blockers.push(`${conflict.factId} 存在待裁定结论冲突(${conflict.current.conclusion} ⇄ ${conflict.incoming.conclusion})`)
  }
  return blockers
}

export interface ApplyResult {
  facts: ClaimFact[]
  effects: string[]
  conflicts: ConclusionConflict[]
}

/**
 * 把单个离线批次应用到主张事实上(纯函数,不修改入参)。
 * 任何操作引用无效都会抛错,由调用方把整批标记为写入失败并保留待重试。
 */
export function applyBatch(claim: Claim, batch: OfflineBatch, now: string, nextId: (prefix: string) => string): ApplyResult {
  if (!batch.ops.length) throw new Error('批次不包含任何操作')
  const facts: ClaimFact[] = structuredClone(claim.facts)
  const effects: string[] = []
  const conflicts: ConclusionConflict[] = []
  const findFact = (factId: string): ClaimFact => {
    const fact = facts.find((item) => item.id === factId)
    if (!fact) throw new Error(`事实 ${factId} 不存在,无法写入`)
    return fact
  }
  for (const op of batch.ops) {
    applyOperation(op, { facts, effects, conflicts, batch, now, nextId, findFact })
  }
  return { facts, effects, conflicts }
}

interface ApplyContext {
  facts: ClaimFact[]
  effects: string[]
  conflicts: ConclusionConflict[]
  batch: OfflineBatch
  now: string
  nextId: (prefix: string) => string
  findFact: (factId: string) => ClaimFact
}

function applyOperation(op: BatchOperation, ctx: ApplyContext): void {
  const { effects, conflicts, batch, now, nextId } = ctx
  switch (op.type) {
    case 'upsert-source': {
      const fact = ctx.findFact(op.factId)
      const list = op.counter ? fact.counterSources : fact.sources
      const sameHash = list.find((item) => !item.retracted && item.contentHash && item.contentHash === op.source.contentHash)
      if (sameHash) {
        // 内容哈希相同:归并为一条记录,只更新保管链与版本,不产生重复证据
        sameHash.version += 1
        sameHash.chainOfCustody = `${sameHash.chainOfCustody} | 批次 ${batch.id} 归并:${op.source.chainOfCustody || '内容一致'}`
        effects.push(`内容哈希相同,归并至 ${sameHash.id}《${sameHash.title}》(V${sameHash.version})`)
        return
      }
      const source: SourceRecord = { ...op.source, id: nextId(op.counter ? 'C' : 'S'), capturedAt: now, version: 1 }
      list.unshift(source)
      effects.push(`${op.counter ? '保留相反证据' : '关联来源'} ${source.id}《${source.title}》`)
      return
    }
    case 'retract-source': {
      const fact = ctx.findFact(op.factId)
      const pool = [...fact.sources, ...fact.counterSources]
      const target = pool.find((item) => !item.retracted && ((op.sourceId && item.id === op.sourceId) || (op.contentHash && item.contentHash === op.contentHash)))
      if (!target) throw new Error(`待撤回来源 ${op.sourceId ?? op.contentHash ?? ''} 不存在或已撤回`)
      target.retracted = { reason: op.reason, at: now, batchId: batch.id }
      effects.push(`撤回来源 ${target.id}《${target.title}》:${op.reason}(记录保留)`)
      return
    }
    case 'add-annotation': {
      const fact = ctx.findFact(op.factId)
      fact.annotations.unshift({ id: nextId('N'), author: op.author, role: op.role, content: op.content, createdAt: now, resolved: false })
      effects.push(`添加批注(${op.role} ${op.author}):${op.content}`)
      return
    }
    case 'resolve-annotation': {
      const fact = ctx.findFact(op.factId)
      const note = fact.annotations.find((item) => !item.resolved && ((op.annotationId && item.id === op.annotationId) || (op.matchContent && item.content.includes(op.matchContent))))
      if (!note) throw new Error(`待解决批注 ${op.annotationId ?? op.matchContent ?? ''} 不存在或已解决`)
      note.resolved = true
      effects.push(`批注标记解决:${note.content}`)
      return
    }
    case 'set-conclusion': {
      const fact = ctx.findFact(op.factId)
      if (fact.conclusion === op.conclusion) {
        effects.push(`结论一致(${op.conclusion}),无需变更`)
        return
      }
      // 结论冲突:不覆盖现有结论,双方同时保留并阻断发布
      const conflict: ConclusionConflict = {
        id: nextId('K'), claimId: batch.claimId, factId: fact.id,
        current: { conclusion: fact.conclusion, source: '工作台当前结论' },
        incoming: { conclusion: op.conclusion, batchId: batch.id, author: batch.author },
        status: '待裁定', createdAt: now
      }
      conflicts.push(conflict)
      effects.push(`结论冲突:保留「${fact.conclusion}」与批次结论「${op.conclusion}」,已阻断发布${op.note ? `(${op.note})` : ''}`)
      return
    }
  }
}

/** 生成演示批次:覆盖证据修改、撤回、批注处理与结论冲突四类操作 */
export function buildSampleBatch(claim: Claim, author: string): OfflineBatch {
  const fact = claim.facts[0]
  const ops: BatchOperation[] = []
  if (fact) {
    ops.push({
      type: 'upsert-source', factId: fact.id, counter: false,
      source: { title: `${fact.text.slice(0, 12)}…补充核验材料`, url: 'https://archive.example/offline-capture', publisher: '核查员离线留档', publishedAt: new Date().toISOString().slice(0, 10), kind: '原始证据', chainOfCustody: `离线设备留档,回网提交`, contentHash: `sha256:${Math.random().toString(16).slice(2, 10)}` }
    })
    const active = [...fact.sources, ...fact.counterSources].find((source) => !source.retracted)
    if (active) ops.push({ type: 'retract-source', factId: fact.id, sourceId: active.id, reason: '离线核验发现来源失效,撤回但保留记录' })
    const open = fact.annotations.find((note) => !note.resolved)
    if (open) ops.push({ type: 'resolve-annotation', factId: fact.id, annotationId: open.id })
    ops.push({ type: 'add-annotation', factId: fact.id, author, role: '事实核查员', content: '离线整理完成,请编辑复核归并结果。' })
    const alternative: FactConclusion = fact.conclusion === '已证实' ? '部分属实' : '已证实'
    ops.push({ type: 'set-conclusion', factId: fact.id, conclusion: alternative, note: '离线判断与工作台不一致,提交裁定' })
  }
  const stamp = new Date().toISOString()
  const base = { claimId: claim.id, author, createdOfflineAt: stamp, note: '演示离线批次', ops }
  return { id: `B-${Date.now().toString(36).toUpperCase()}`, device: '离线采集终端', contentHash: hashBatchContent(base), ...base }
}
