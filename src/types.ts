export type ClaimStatus = '核查中' | '待编辑复核' | '已发布' | '已撤回'
export type FactConclusion = '已证实' | '部分属实' | '证据不足' | '不实'
export type EvidenceKind = '原始证据' | '二次来源' | '待证信息'
export type BatchStatus = '待处理' | '已应用' | '失败'
export type BatchOpKind = '证据修改' | '证据撤回' | '批注处理'

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

export interface AuditEntry {
  id: string
  claimId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface BatchEvidenceOp {
  kind: '证据修改'
  factId: string
  counter: boolean
  source: Omit<SourceRecord, 'id' | 'capturedAt' | 'version'>
  conclusion?: FactConclusion
}

export interface BatchWithdrawOp {
  kind: '证据撤回'
  factId: string
  sourceId?: string
  contentHash?: string
  reason: string
}

export type BatchAnnotationOp =
  | { kind: '批注处理'; factId: string; mode: '添加'; annotation: { author: string; role: ClaimAnnotation['role']; content: string } }
  | { kind: '批注处理'; factId: string; mode: '解决'; annotationId: string }

export type BatchOperation = BatchEvidenceOp | BatchWithdrawOp | BatchAnnotationOp

export interface OfflineBatch {
  id: string
  claimId: string
  inspector: string
  device?: string
  createdAt: string
  contentHash: string
  operations: BatchOperation[]
  status: BatchStatus
  failReason?: string
  appliedAt?: string
  appliedVersion?: number
}

export interface ConclusionProposal {
  conclusion: FactConclusion
  batchId: string
  inspector: string
  at: string
}

export interface MergeConflict {
  id: string
  claimId: string
  factId: string
  type: '结论冲突'
  proposals: ConclusionProposal[]
  detectedAt: string
  resolved: boolean
}
