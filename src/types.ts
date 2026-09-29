export type ClaimStatus = '核查中' | '待编辑复核' | '已发布' | '已撤回'
export type FactConclusion = '已证实' | '部分属实' | '证据不足' | '不实'
export type EvidenceKind = '原始证据' | '二次来源' | '待证信息'

export interface SourceRecord {
  id: string
  title: string
  url: string
  publisher: string
  publishedAt: string
  capturedAt: string
  kind: EvidenceKind
  chainOfCustody: string
  contentHash: string
  version: number
  supersededBy?: string
  retracted?: { reason: string; at: string; batchId?: string }
}

export interface ClaimAnnotation {
  id: string
  author: string
  role: '记者' | '编辑' | '事实核查员'
  content: string
  createdAt: string
  resolved: boolean
}

export interface ClaimFact {
  id: string
  text: string
  conclusion: FactConclusion
  confidence: number
  unresolved: string[]
  sources: SourceRecord[]
  counterSources: SourceRecord[]
  annotations: ClaimAnnotation[]
}

export interface Claim {
  id: string
  title: string
  summary: string
  reporter: string
  editor: string
  status: ClaimStatus
  priority: '低' | '中' | '高'
  createdAt: string
  updatedAt: string
  version: number
  facts: ClaimFact[]
}

export interface VersionRecord {
  id: string
  claimId: string
  version: number
  editor: string
  summary: string
  changedFactIds: string[]
  removedEvidence: string[]
  createdAt: string
  mergedBatchIds?: string[]
  conflictIds?: string[]
}

export type BatchOperation =
  | { type: 'upsert-source'; factId: string; counter: boolean; source: Omit<SourceRecord, 'id' | 'capturedAt' | 'version' | 'retracted'> }
  | { type: 'retract-source'; factId: string; sourceId?: string; contentHash?: string; reason: string }
  | { type: 'add-annotation'; factId: string; author: string; role: ClaimAnnotation['role']; content: string }
  | { type: 'resolve-annotation'; factId: string; annotationId?: string; matchContent?: string }
  | { type: 'set-conclusion'; factId: string; conclusion: FactConclusion; note?: string }

export interface OfflineBatch {
  id: string
  claimId: string
  author: string
  device: string
  createdOfflineAt: string
  contentHash: string
  note: string
  ops: BatchOperation[]
}

export type BatchStatus = '待写入' | '已合并' | '重复跳过' | '写入失败'

export interface BatchRecord extends OfflineBatch {
  status: BatchStatus
  attempts: number
  lastError?: string
  mergedAt?: string
  mergedVersion?: number
  effects: string[]
}

export interface ConclusionConflict {
  id: string
  claimId: string
  factId: string
  current: { conclusion: FactConclusion; source: string }
  incoming: { conclusion: FactConclusion; batchId: string; author: string }
  status: '待裁定' | '已裁定'
  resolution?: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  claimId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}
