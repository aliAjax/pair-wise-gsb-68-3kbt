import type { AuditEntry, BatchRecord, Claim, ConclusionConflict, VersionRecord } from '../types'

export const seedClaims: Claim[] = [
  {
    id: 'FC-260929-01', title: '某地新建数据中心停用全部柴油应急电源', summary: '社交平台流传项目验收文件截图,称数据中心取消柴油发电机改为纯储能供电。',
    reporter: '沈言', editor: '宋卓', status: '待编辑复核', priority: '高', createdAt: '2026-09-29T08:10:00', updatedAt: '2026-09-29T15:30:00', version: 4,
    facts: [
      {
        id: 'F-1', text: '项目规划文件中曾包含2台柴油发电机组。', conclusion: '已证实', confidence: 98, unresolved: [],
        sources: [
          { id: 'S-1', title: '一期工程环境影响报告表', url: 'https://example.gov.cn/report/2025-1102', publisher: '市生态环境局', publishedAt: '2025-11-02', capturedAt: '2026-09-29T08:40:00', kind: '原始证据', chainOfCustody: '官网下载PDF,哈希时间戳已记录', contentHash: 'sha256:9d31f1...a42c', version: 1 },
          { id: 'S-2', title: '项目设备采购公告', url: 'https://example.com/tender/8821', publisher: '公共资源交易平台', publishedAt: '2026-01-18', capturedAt: '2026-09-29T08:52:00', kind: '原始证据', chainOfCustody: '官网页面快照与原始附件同时留存', contentHash: 'sha256:7bc029...de10', version: 2 }
        ], counterSources: [], annotations: [{ id: 'N-1', author: '宋卓', role: '编辑', content: '请补充规划变更批复,不能用采购公告单独代表最终方案。', createdAt: '2026-09-29T10:20:00', resolved: false }]
      },
      {
        id: 'F-2', text: '最终验收已取消柴油应急电源。', conclusion: '证据不足', confidence: 42, unresolved: ['缺少竣工验收备案原件', '网传截图无文件编号与签章页'],
        sources: [{ id: 'S-3', title: '匿名用户上传的验收文件局部截图', url: 'https://social.example/post/9901', publisher: '社交平台账号', publishedAt: '2026-09-28', capturedAt: '2026-09-29T09:05:00', kind: '待证信息', chainOfCustody: '已保存原帖与图片EXIF,待向主管部门核验', contentHash: 'sha256:1fe210...67bd', version: 1 }],
        counterSources: [{ id: 'C-1', title: '储能系统招标文件仍列出柴发切换接口', url: 'https://example.com/tender/9102', publisher: '公共资源交易平台', publishedAt: '2026-03-04', capturedAt: '2026-09-29T14:10:00', kind: '原始证据', chainOfCustody: '附件原文留存,相关条款见第42页', contentHash: 'sha256:c7249a...001f', version: 1 }],
        annotations: [{ id: 'N-2', author: '陆衡', role: '事实核查员', content: '该结论不得以匿名截图单独成立,需取得主管部门书面确认。', createdAt: '2026-09-29T14:25:00', resolved: false }]
      },
      {
        id: 'F-3', text: '纯储能方案足以覆盖消防和一级负荷供电。', conclusion: '证据不足', confidence: 31, unresolved: ['缺少负荷计算书', '缺少消防验收文件'],
        sources: [{ id: 'S-4', title: '设备厂商技术白皮书', url: 'https://vendor.example/white-paper', publisher: '设备厂商', publishedAt: '2026-05-12', capturedAt: '2026-09-29T11:10:00', kind: '二次来源', chainOfCustody: '厂商官网PDF留存', contentHash: 'sha256:6a8d22...41ee', version: 1 }],
        counterSources: [], annotations: []
      }
    ]
  },
  {
    id: 'FC-260928-03', title: '城区供水异味来自河道藻类暴发', summary: '居民投诉自来水异味,网络传言指向上游工业排放,需核查水质报告与采样链。',
    reporter: '顾薇', editor: '宋卓', status: '核查中', priority: '中', createdAt: '2026-09-28T09:00:00', updatedAt: '2026-09-29T13:10:00', version: 2,
    facts: [
      { id: 'F-4', text: '多个采样点的2-甲基异莰醇检测值超过嗅阈值。', conclusion: '已证实', confidence: 93, unresolved: [], sources: [{ id: 'S-5', title: '市供水水质周报', url: 'https://example.gov.cn/water/0928', publisher: '市水务局', publishedAt: '2026-09-28', capturedAt: '2026-09-28T16:20:00', kind: '原始证据', chainOfCustody: '官网数据与PDF报告留存', contentHash: 'sha256:228a2...09cf', version: 1 }], counterSources: [], annotations: [] },
      { id: 'F-5', text: '异味由上游企业偷排直接造成。', conclusion: '不实', confidence: 88, unresolved: [], sources: [], counterSources: [{ id: 'C-2', title: '上游排口在线监测与执法巡查记录', url: 'https://example.gov.cn/env/0929', publisher: '市生态环境局', publishedAt: '2026-09-29', capturedAt: '2026-09-29T12:00:00', kind: '原始证据', chainOfCustody: '官方接口导出CSV,记录数据签名', contentHash: 'sha256:ab45d...9c31', version: 1 }], annotations: [] }
    ]
  }
]

export const seedVersions: VersionRecord[] = [
  { id: 'V-1', claimId: 'FC-260929-01', version: 4, editor: '沈言', summary: '补充储能系统招标文件和相反证据,降低第二、第三项事实置信度。', changedFactIds: ['F-2', 'F-3'], removedEvidence: ['匿名聊天记录截图'], createdAt: '2026-09-29T15:30:00', mergedBatchIds: ['B-0929-B'], conflictIds: ['K-1'] },
  { id: 'V-2', claimId: 'FC-260929-01', version: 3, editor: '陆衡', summary: '补充匿名截图保管链和未解决疑点。', changedFactIds: ['F-2'], removedEvidence: [], createdAt: '2026-09-29T14:25:00', mergedBatchIds: ['B-0929-A'], conflictIds: [] }
]

export const seedBatches: BatchRecord[] = [
  {
    id: 'B-0929-C', claimId: 'FC-260929-01', author: '沈言', device: '手机离线采集', createdOfflineAt: '2026-09-29T16:05:00',
    contentHash: 'fnv1a:55aa09c1', note: '主管部门口头回复与现场照片整理',
    ops: [
      { type: 'set-conclusion', factId: 'F-2', conclusion: '已证实', note: '据称主管部门已口头确认' },
      { type: 'upsert-source', factId: 'F-2', counter: false, source: { title: '主管部门电话核实记录(整理稿)', url: 'https://notes.example/call-1630', publisher: '核查员整理', publishedAt: '2026-09-29', kind: '待证信息', chainOfCustody: '通话记录截图离线留存,待书面确认', contentHash: 'sha256:77e1ac...b902' } }
    ],
    status: '写入失败', attempts: 2, lastError: '写入存储时连接中断,批次已保留待重试', effects: []
  },
  {
    id: 'B-0929-B', claimId: 'FC-260929-01', author: '沈言', device: '现场笔记本-02', createdOfflineAt: '2026-09-29T15:02:00',
    contentHash: 'fnv1a:9c04d2e7', note: '招标文件与负荷疑点补充',
    ops: [
      { type: 'upsert-source', factId: 'F-2', counter: true, source: { title: '储能系统招标文件仍列出柴发切换接口', url: 'https://example.com/tender/9102', publisher: '公共资源交易平台', publishedAt: '2026-03-04', kind: '原始证据', chainOfCustody: '附件原文留存,相关条款见第42页', contentHash: 'sha256:c7249a...001f' } },
      { type: 'set-conclusion', factId: 'F-2', conclusion: '部分属实', note: '沈言离线判断,与当前结论不一致' }
    ],
    status: '已合并', attempts: 1, mergedAt: '2026-09-29T15:30:00', mergedVersion: 4,
    effects: ['保留相反证据 C-1《储能系统招标文件仍列出柴发切换接口》', '结论冲突:保留「证据不足」与批次结论「部分属实」,已阻断发布']
  },
  {
    id: 'B-0929-A', claimId: 'FC-260929-01', author: '陆衡', device: '现场笔记本-01', createdOfflineAt: '2026-09-29T13:40:00',
    contentHash: 'fnv1a:8f3c21aa', note: '匿名截图保管链补充',
    ops: [
      { type: 'upsert-source', factId: 'F-2', counter: false, source: { title: '匿名用户上传的验收文件局部截图', url: 'https://social.example/post/9901', publisher: '社交平台账号', publishedAt: '2026-09-28', kind: '待证信息', chainOfCustody: '已保存原帖与图片EXIF,待向主管部门核验', contentHash: 'sha256:1fe210...67bd' } },
      { type: 'add-annotation', factId: 'F-2', author: '陆衡', role: '事实核查员', content: '该结论不得以匿名截图单独成立,需取得主管部门书面确认。' }
    ],
    status: '已合并', attempts: 1, mergedAt: '2026-09-29T14:25:00', mergedVersion: 3,
    effects: ['关联来源 S-3《匿名用户上传的验收文件局部截图》', '添加批注(事实核查员 陆衡):该结论不得以匿名截图单独成立,需取得主管部门书面确认。']
  }
]

export const seedConflicts: ConclusionConflict[] = [
  { id: 'K-1', claimId: 'FC-260929-01', factId: 'F-2', current: { conclusion: '证据不足', source: '工作台当前结论' }, incoming: { conclusion: '部分属实', batchId: 'B-0929-B', author: '沈言' }, status: '待裁定', createdAt: '2026-09-29T15:30:00' }
]

export const seedAudit: AuditEntry[] = [
  { id: 'A-1', claimId: 'FC-260929-01', action: '建立核查主张', operator: '沈言', detail: '创建3项可验证事实', createdAt: '2026-09-29T08:10:00' },
  { id: 'A-2', claimId: 'FC-260929-01', action: '关联原始证据', operator: '沈言', detail: '关联环评报告和设备采购公告', createdAt: '2026-09-29T08:55:00' },
  { id: 'A-3', claimId: 'FC-260929-01', action: '添加相反证据', operator: '陆衡', detail: '储能招标附件与纯储能结论冲突,保留争议', createdAt: '2026-09-29T14:10:00' }
]
