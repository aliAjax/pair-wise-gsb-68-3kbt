import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, Box, Button, Divider, Flex, FormControl, FormLabel, Grid, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Tab, TabList, TabPanel, TabPanels, Tabs, Text, Textarea, useDisclosure, useToast, VStack } from '@chakra-ui/react'
import { EvidenceGraph } from '../components/EvidenceGraph'
import { conclusionColor, useClaimStore } from '../store/useClaimStore'
import { hashBatchContent } from '../lib/merge'
import type { BatchOperation, ClaimFact, EvidenceKind, FactConclusion, OfflineBatch, SourceRecord } from '../types'

export function ClaimWorkspace() {
  const { id } = useParams()
  const toast = useToast()
  const state = useClaimStore()
  const claim = state.claims.find((item) => item.id === id)
  const batches = (state.batches ?? []).filter((item) => item.claimId === id)
  const [selectedFactId, setSelectedFactId] = useState(claim?.facts[0]?.id ?? '')
  const selectedFact = claim?.facts.find((item) => item.id === selectedFactId) ?? claim?.facts[0]
  const [factText, setFactText] = useState('')
  const sourceModal = useDisclosure()
  const versionModal = useDisclosure()
  const batchModal = useDisclosure()
  const [batchJson, setBatchJson] = useState('')
  const [sourceForm, setSourceForm] = useState<Omit<SourceRecord, 'id' | 'capturedAt' | 'version'>>({ title: '', url: '', publisher: '', publishedAt: '2026-09-29', kind: '原始证据', chainOfCustody: '', contentHash: '' })
  const [counterSource, setCounterSource] = useState(false)
  const [transitionNote, setTransitionNote] = useState('')
  useEffect(() => { if (!selectedFactId && claim?.facts[0]) setSelectedFactId(claim.facts[0].id) }, [selectedFactId, claim])
  if (!claim) return <Box p="10">未找到核查主张</Box>
  const setFact = (patch: Partial<ClaimFact>) => { if (selectedFact) state.updateFact(claim.id, selectedFact.id, patch) }
  const addSource = () => {
    if (!selectedFact || !sourceForm.title || !sourceForm.url) return
    state.addSource(claim.id, selectedFact.id, sourceForm, counterSource)
    sourceModal.onClose()
    toast({ title: '证据已加入关系图', status: 'success' })
  }
  const transition = (status: typeof claim.status) => {
    const result = state.transitionClaim(claim.id, status, transitionNote || `由${claim.status}流转至${status}`)
    toast({ title: result.message, status: result.ok ? 'success' : 'error' })
    if (result.ok) versionModal.onClose()
  }
  const loadDemoBatches = () => {
    const now = new Date().toISOString()
    const mk = (suffix: string, operations: BatchOperation[]): OfflineBatch => ({
      id: `OFF-${claim.id}-DEMO-${suffix}`,
      claimId: claim.id,
      inspector: '陆衡',
      device: '离线采集终端-02',
      createdAt: now,
      contentHash: hashBatchContent(operations),
      operations,
      status: '待处理',
    })
    const d1 = mk('D1', [
      { kind: '证据撤回', factId: 'F-2', sourceId: 'S-3', reason: '截图来源不明，离线核验无法确认原始出处' },
      { kind: '证据修改', factId: 'F-2', counter: false, conclusion: '部分属实', source: { title: '主管部门书面回复', url: 'https://example.gov.cn/reply/2026-092', publisher: '市住建局', publishedAt: '2026-09-29', kind: '原始证据', chainOfCustody: '离线收件，回网后上传扫描件', contentHash: 'sha256:off-demo-reply' } },
      { kind: '批注处理', factId: 'F-2', mode: '添加', annotation: { author: '陆衡', role: '事实核查员', content: '离线取得主管部门书面回复，验收已取消柴发应急电源。' } }
    ])
    const input: OfflineBatch[] = [
      d1,
      mk('D2', [{ kind: '证据撤回', factId: 'F-2', contentHash: 'sha256:off-demo-reply', reason: '误传回复件，撤回' }]),
      { ...d1 },
      mk('D4', [{ kind: '证据撤回', factId: 'F-2', sourceId: 'S-OFF-MISSING', reason: '演示永久失败批次' }])
    ]
    const result = state.importOfflineBatches(claim.id, input)
    toast({ title: result.message, status: result.failed ? 'warning' : 'success', duration: 6000 })
  }
  const importBatchJson = () => {
    if (!batchJson.trim()) return
    try {
      const parsed = JSON.parse(batchJson) as OfflineBatch[] | OfflineBatch
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const result = state.importOfflineBatches(claim.id, list)
      toast({ title: result.message, status: result.failed ? 'warning' : 'success', duration: 6000 })
      batchModal.onClose()
      setBatchJson('')
    } catch {
      toast({ title: 'JSON 解析失败，请检查批次格式', status: 'error' })
    }
  }
  const exportArchive = () => {
    const versions = state.versions.filter((item) => item.claimId === claim.id)
    const audit = state.audit.filter((item) => item.claimId === claim.id)
    const blob = new Blob([JSON.stringify({ claim, versions, audit }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${claim.id}-核查档案.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  return <Box p="6" pb="16">
    <Flex justify="space-between" align="flex-start" mb="4"><Box><Text fontSize="xs" color="gray.600">{claim.id} · {claim.reporter} / {claim.editor} · V{claim.version}</Text><Text fontSize="xl" fontWeight="700" mt="1">{claim.title}</Text><Text color="gray.600" fontSize="sm" mt="2" maxW="760px">{claim.summary}</Text></Box><Flex gap="2"><Button variant="outline" onClick={exportArchive}>导出档案</Button><Button colorScheme="teal" onClick={versionModal.onOpen}>状态与版本</Button></Flex></Flex>
    <EvidenceGraph facts={claim.facts} />
    <Grid mt="4" templateColumns="320px 1fr" gap="4" alignItems="start">
      <VStack align="stretch" spacing="4">
        <Box bg="white" borderWidth="1px" p="3">
          <Flex justify="space-between" align="center" mb="3"><Text fontWeight="700">可验证事实树</Text><Badge>{claim.facts.length}</Badge></Flex>
          {claim.facts.map((fact) => <Box key={fact.id} as="button" textAlign="left" w="100%" p="3" mb="2" borderWidth="1px" borderColor={fact.id === selectedFact?.id ? 'teal.600' : 'gray.200'} bg={fact.id === selectedFact?.id ? 'teal.50' : 'white'} onClick={() => setSelectedFactId(fact.id)}><Flex justify="space-between"><Text fontSize="xs" color="gray.500">{fact.id}</Text><Badge colorScheme={conclusionColor[fact.conclusion]}>{fact.conclusion}</Badge></Flex><Text fontSize="sm" mt="2" fontWeight="600">{fact.text}</Text><Text fontSize="xs" color="gray.500" mt="2">置信度 {fact.confidence}% · 疑点 {fact.unresolved.length}</Text></Box>)}
          <Flex mt="3" gap="2"><Input size="sm" placeholder="拆出新的可验证事实" value={factText} onChange={(event) => setFactText(event.target.value)} /><Button size="sm" colorScheme="teal" onClick={() => { state.addFact(claim.id, factText); setFactText('') }}>添加</Button></Flex>
        </Box>
        <Box bg="white" borderWidth="1px" p="3">
          <Flex justify="space-between" align="center" mb="2"><Text fontWeight="700">离线证据批次</Text><Badge>{batches.length}</Badge></Flex>
          <Text fontSize="xs" color="gray.500" mb="3">断网期间按主张归集的证据修改、撤回与批注，回网后一次性合并。重复批次只处理一次，哈希相同归并，结论冲突同时保留并阻止发布；失败批次保留待重试，已成功批次不丢失。</Text>
          <Flex gap="2" mb="3"><Button size="sm" colorScheme="teal" onClick={loadDemoBatches}>载入离线演示批次</Button><Button size="sm" variant="outline" onClick={batchModal.onOpen}>导入批次 JSON</Button></Flex>
          {batches.length === 0 && <Text fontSize="xs" color="gray.400">暂无离线批次</Text>}
          {batches.map((batch) => <OfflineBatchRow key={batch.id} batch={batch} onRetry={() => { const result = state.retryOfflineBatch(claim.id, batch.id); toast({ title: result.message, status: result.ok ? 'success' : 'warning' }) }} />)}
        </Box>
      </VStack>
      {selectedFact && <Box bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between" align="flex-start"><Box><Text fontSize="xs" color="gray.500">{selectedFact.id}</Text><Text fontWeight="700" mt="1">{selectedFact.text}</Text></Box><Badge colorScheme={conclusionColor[selectedFact.conclusion]}>{selectedFact.conclusion}</Badge></Flex>
        <Grid templateColumns="1fr 1fr 1fr" gap="3" mt="4">
          <FormControl><FormLabel fontSize="xs">事实结论</FormLabel><Select size="sm" value={selectedFact.conclusion} onChange={(event) => setFact({ conclusion: event.target.value as FactConclusion })}>{['已证实', '部分属实', '证据不足', '不实'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl>
          <FormControl><FormLabel fontSize="xs">置信程度 {selectedFact.confidence}%</FormLabel><Input size="sm" type="range" min="0" max="100" value={selectedFact.confidence} onChange={(event) => setFact({ confidence: Number(event.target.value) })} /></FormControl>
          <FormControl><FormLabel fontSize="xs">未解决疑点</FormLabel><Input size="sm" value={selectedFact.unresolved.join('；')} onChange={(event) => setFact({ unresolved: event.target.value ? event.target.value.split('；') : [] })} /></FormControl>
        </Grid>
        <Tabs mt="5" colorScheme="teal">
          <TabList><Tab>支持证据 {selectedFact.sources.length}</Tab><Tab>相反证据 {selectedFact.counterSources.length}</Tab><Tab>批注 {selectedFact.annotations.length}</Tab><Tab>来源时间线</Tab></TabList>
          <TabPanels>
            <TabPanel px="0"><EvidenceList sources={selectedFact.sources} claimId={claim.id} onAdd={() => { setCounterSource(false); sourceModal.onOpen() }} /></TabPanel>
            <TabPanel px="0"><EvidenceList sources={selectedFact.counterSources} claimId={claim.id} onAdd={() => { setCounterSource(true); sourceModal.onOpen() }} counter /></TabPanel>
            <TabPanel px="0"><AnnotationList fact={selectedFact} claimId={claim.id} /></TabPanel>
            <TabPanel px="0"><Box borderLeftWidth="2px" borderColor="gray.300" pl="4">{[...selectedFact.sources, ...selectedFact.counterSources].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).map((source) => <Box key={source.id} mb="4"><Text fontSize="xs" color="gray.500">{source.publishedAt} · {source.kind}</Text><Text fontWeight="600" mt="1">{source.title}</Text><Text fontSize="sm" color="gray.600">{source.publisher} · 留档 {source.capturedAt.replace('T', ' ').slice(0, 16)}</Text></Box>)}</Box></TabPanel>
          </TabPanels>
        </Tabs>
      </Box>}
    </Grid>
    <Modal isOpen={sourceModal.isOpen} onClose={sourceModal.onClose} size="xl"><ModalOverlay /><ModalContent><ModalHeader>{counterSource ? '关联相反证据' : '关联支持证据'}</ModalHeader><ModalCloseButton /><ModalBody><Grid templateColumns="1fr 1fr" gap="3"><FormControl><FormLabel>来源标题</FormLabel><Input value={sourceForm.title} onChange={(event) => setSourceForm({ ...sourceForm, title: event.target.value })} /></FormControl><FormControl><FormLabel>公开地址</FormLabel><Input value={sourceForm.url} onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })} /></FormControl><FormControl><FormLabel>发布机构</FormLabel><Input value={sourceForm.publisher} onChange={(event) => setSourceForm({ ...sourceForm, publisher: event.target.value })} /></FormControl><FormControl><FormLabel>证据类型</FormLabel><Select value={sourceForm.kind} onChange={(event) => setSourceForm({ ...sourceForm, kind: event.target.value as EvidenceKind })}>{['原始证据', '二次来源', '待证信息'].map((value) => <option key={value}>{value}</option>)}</Select></FormControl><FormControl><FormLabel>内容哈希</FormLabel><Input placeholder="sha256:..." value={sourceForm.contentHash} onChange={(event) => setSourceForm({ ...sourceForm, contentHash: event.target.value })} /></FormControl><FormControl><FormLabel>留档说明</FormLabel><Input value={sourceForm.chainOfCustody} onChange={(event) => setSourceForm({ ...sourceForm, chainOfCustody: event.target.value })} /></FormControl></Grid></ModalBody><ModalFooter><Button variant="ghost" mr="3" onClick={sourceModal.onClose}>取消</Button><Button colorScheme="teal" isDisabled={!sourceForm.title || !sourceForm.url} onClick={addSource}>加入证据关系图</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={versionModal.isOpen} onClose={versionModal.onClose}><ModalOverlay /><ModalContent><ModalHeader>状态流转与版本说明</ModalHeader><ModalCloseButton /><ModalBody><FormControl mb="4"><FormLabel>版本变更说明</FormLabel><Textarea rows={4} value={transitionNote} onChange={(event) => setTransitionNote(event.target.value)} /></FormControl><Text fontSize="xs" color="gray.500">待编辑复核需要至少一项事实；发布时会拦截证据不足且存在疑点的事实。</Text></ModalBody><ModalFooter><Button mr="2" onClick={() => transition('待编辑复核')}>提交编辑复核</Button><Button colorScheme="teal" onClick={() => transition('已发布')}>发布正式版本</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={batchModal.isOpen} onClose={batchModal.onClose} size="xl"><ModalOverlay /><ModalContent><ModalHeader>导入离线批次 JSON</ModalHeader><ModalCloseButton /><ModalBody><Text fontSize="xs" color="gray.500" mb="3">粘贴离线端导出的批次（单批或批次数组）。重复批次按批次 id 与内容哈希去重；写入失败的批次保留为「失败」可重试。</Text><Textarea rows={10} fontFamily="mono" fontSize="xs" placeholder='[{"id":"OFF-...","operations":[...]}]' value={batchJson} onChange={(event) => setBatchJson(event.target.value)} /></ModalBody><ModalFooter><Button variant="ghost" mr="3" onClick={batchModal.onClose}>取消</Button><Button colorScheme="teal" isDisabled={!batchJson.trim()} onClick={importBatchJson}>合并批次</Button></ModalFooter></ModalContent></Modal>
  </Box>
}

function OfflineBatchRow({ batch, onRetry }: { batch: OfflineBatch; onRetry: () => void }) {
  const ops = batch.operations
  const kinds = [
    ops.some((item) => item.kind === '证据修改') && '证据修改',
    ops.some((item) => item.kind === '证据撤回') && '证据撤回',
    ops.some((item) => item.kind === '批注处理') && '批注处理'
  ].filter(Boolean).join(' · ')
  return <Box borderWidth="1px" p="2" mb="2" borderColor={batch.status === '失败' ? 'red.300' : batch.status === '已应用' ? 'green.300' : 'gray.200'} bg={batch.status === '失败' ? 'red.50' : batch.status === '已应用' ? 'green.50' : 'white'}>
    <Flex justify="space-between" align="center"><Text fontFamily="mono" fontSize="xs">{batch.id}</Text><Badge colorScheme={batch.status === '已应用' ? 'green' : batch.status === '失败' ? 'red' : 'orange'}>{batch.status}</Badge></Flex>
    <Text fontSize="xs" color="gray.600" mt="1">{batch.inspector}{batch.device ? ` · ${batch.device}` : ''} · {batch.createdAt.replace('T', ' ').slice(0, 16)}</Text>
    <Text fontSize="xs" mt="1">{ops.length} 项操作{` · ${kinds}`}</Text>
    <Text fontFamily="mono" fontSize="xs" color="gray.500" mt="1">{batch.contentHash}</Text>
    {batch.status === '失败' && <><Text fontSize="xs" color="red.600" mt="1">失败原因：{batch.failReason}</Text><Button size="xs" colorScheme="red" variant="outline" mt="2" onClick={onRetry}>重试该批</Button></>}
    {batch.status === '已应用' && <Text fontSize="xs" color="green.700" mt="1">已于 {batch.appliedAt?.replace('T', ' ').slice(0, 16)} 合并入 V{batch.appliedVersion}</Text>}
  </Box>
}

function EvidenceList({ sources, claimId, onAdd, counter = false }: { sources: SourceRecord[]; claimId: string; onAdd: () => void; counter?: boolean }) {
  return <Box><Flex justify="space-between" mb="3"><Text fontSize="sm" color="gray.600">{counter ? '相反证据与支持证据并列保留' : '按原始证据、二次来源、待证信息分类'}</Text><Button size="sm" colorScheme={counter ? 'red' : 'teal'} variant="outline" onClick={onAdd}>{counter ? '关联相反证据' : '关联支持证据'}</Button></Flex>{sources.map((source) => <Box key={source.id} borderWidth="1px" p="3" mb="2"><Flex justify="space-between"><Text fontWeight="600">{source.title}</Text><Badge colorScheme={source.kind === '原始证据' ? 'green' : source.kind === '二次来源' ? 'orange' : 'gray'}>{source.kind}</Badge></Flex><Text fontSize="xs" color="gray.600" mt="2">{source.publisher} · {source.publishedAt} · V{source.version}</Text><Text fontFamily="mono" fontSize="xs" mt="2">{source.contentHash}</Text><Divider my="2" /><Text fontSize="xs">{source.chainOfCustody}</Text><Text fontSize="xs" color="blue.600" mt="1" wordBreak="break-all">{source.url}</Text></Box>)}</Box>
}

function AnnotationList({ fact, claimId }: { fact: ClaimFact; claimId: string }) {
  const addAnnotation = useClaimStore((state) => state.addAnnotation)
  const resolve = useClaimStore((state) => state.resolveAnnotation)
  const [text, setText] = useState('')
  return <Box><Flex gap="2" mb="3"><Input placeholder="添加事实核查批注" value={text} onChange={(event) => setText(event.target.value)} /><Button onClick={() => { addAnnotation(claimId, fact.id, { author: '陆衡', role: '事实核查员', content: text }); setText('') }}>添加</Button></Flex>{fact.annotations.map((item) => <Box key={item.id} borderLeftWidth="3px" borderColor={item.resolved ? 'green.400' : 'orange.400'} bg={item.resolved ? 'green.50' : 'orange.50'} p="3" mb="2"><Flex justify="space-between"><Text fontWeight="600" fontSize="sm">{item.role} {item.author}</Text><Button size="xs" variant="ghost" isDisabled={item.resolved} onClick={() => resolve(claimId, fact.id, item.id)}>{item.resolved ? '已解决' : '标记解决'}</Button></Flex><Text fontSize="sm" mt="2">{item.content}</Text><Text fontSize="xs" color="gray.500" mt="1">{item.createdAt.replace('T', ' ').slice(0, 16)}</Text></Box>)}</Box>
}
