import { useState } from 'react'
import { Badge, Box, Button, Checkbox, Divider, Flex, Grid, Text, Textarea, useToast } from '@chakra-ui/react'
import { batchStatusColor, conclusionColor, useClaimStore } from '../store/useClaimStore'
import { buildSampleBatch } from '../services/offlineMerge'
import type { Claim, OfflineBatch } from '../types'

export function OfflineMergePanel({ claim }: { claim: Claim }) {
  const state = useClaimStore()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const batches = state.batches.filter((item) => item.claimId === claim.id)
  const conflicts = state.conflicts.filter((item) => item.claimId === claim.id)
  const openConflicts = conflicts.filter((item) => item.status === '待裁定')

  const fillSample = () => setDraft(JSON.stringify([buildSampleBatch(claim, '陆衡')], null, 2))

  const submit = () => {
    let parsed: OfflineBatch[]
    try {
      const raw = JSON.parse(draft) as unknown
      parsed = Array.isArray(raw) ? raw : [raw as OfflineBatch]
      if (!parsed.length) throw new Error('至少提交一批记录')
      for (const batch of parsed) {
        if (!batch.id || !Array.isArray(batch.ops)) throw new Error(`批次 ${batch.id ?? '(无编号)'} 缺少 id 或 ops`)
        batch.claimId = claim.id
        batch.author = batch.author || '陆衡'
        batch.device = batch.device || '离线终端'
        batch.createdOfflineAt = batch.createdOfflineAt || new Date().toISOString()
        batch.note = batch.note || ''
        batch.contentHash = batch.contentHash || ''
      }
    } catch (error) {
      toast({ title: `批次格式错误:${error instanceof Error ? error.message : String(error)}`, status: 'error' })
      return
    }
    const summary = state.submitBatches(claim.id, parsed, simulateFailure ? parsed.map((batch) => batch.id) : [])
    const parts = [`合并 ${summary.merged.length} 批`, `重复跳过 ${summary.duplicated.length} 批`, `失败保留 ${summary.failed.length} 批`]
    if (summary.conflicts.length) parts.push(`新增结论冲突 ${summary.conflicts.length} 起,已阻断发布`)
    toast({ title: parts.join(' · '), status: summary.failed.length ? 'warning' : 'success' })
    setDraft('')
  }

  return <Box mt="4" bg="white" borderWidth="1px" p="4">
    <Flex justify="space-between" align="center" mb="1">
      <Text fontWeight="700">离线批次合并</Text>
      <Text fontSize="xs" color="gray.500">重复批次只处理一次 · 内容哈希相同自动归并 · 结论冲突双方保留并阻断发布 · 合并后重算置信度</Text>
    </Flex>
    <Grid templateColumns="1fr 1fr" gap="4" mt="3" alignItems="start">
      <Box>
        <Text fontSize="sm" fontWeight="600" mb="2">提交离线批次(JSON,可一次多批)</Text>
        <Textarea rows={10} fontFamily="mono" fontSize="xs" placeholder='[{"id":"B-...","ops":[{"type":"upsert-source","factId":"F-1","counter":false,"source":{...}}]}]' value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Flex mt="2" gap="2" align="center">
          <Button size="sm" variant="outline" onClick={fillSample}>生成示例批次</Button>
          <Checkbox size="sm" isChecked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)}>模拟写入失败</Checkbox>
          <Button size="sm" colorScheme="teal" isDisabled={!draft.trim()} onClick={submit}>提交合并</Button>
        </Flex>
        {openConflicts.length > 0 && <Box mt="4">
          <Text fontSize="sm" fontWeight="600" mb="2">待裁定结论冲突 {openConflicts.length}</Text>
          {openConflicts.map((conflict) => <Box key={conflict.id} borderWidth="1px" borderColor="red.300" bg="red.50" p="3" mb="2">
            <Flex justify="space-between" align="center">
              <Text fontSize="xs" color="gray.600">{conflict.factId} · 来自批次 {conflict.incoming.batchId}({conflict.incoming.author})</Text>
              <Badge colorScheme="red">阻断发布</Badge>
            </Flex>
            <Flex mt="2" gap="2" align="center">
              <Badge colorScheme={conclusionColor[conflict.current.conclusion]}>{conflict.current.conclusion}</Badge>
              <Text fontSize="xs" color="gray.500">工作台当前</Text>
              <Text fontSize="xs">⇄</Text>
              <Badge colorScheme={conclusionColor[conflict.incoming.conclusion]}>{conflict.incoming.conclusion}</Badge>
              <Text fontSize="xs" color="gray.500">离线批次</Text>
            </Flex>
            <Flex mt="3" gap="2">
              <Button size="xs" variant="outline" onClick={() => state.resolveConflict(conflict.id, 'current', '编辑裁定保留工作台结论')}>保留工作台结论</Button>
              <Button size="xs" colorScheme="teal" onClick={() => state.resolveConflict(conflict.id, 'incoming', '编辑裁定采纳离线批次结论')}>采纳批次结论</Button>
            </Flex>
          </Box>)}
        </Box>}
      </Box>
      <Box>
        <Text fontSize="sm" fontWeight="600" mb="2">批次记录 {batches.length}</Text>
        {batches.length === 0 && <Text fontSize="sm" color="gray.500">暂无离线批次,断网整理的记录回网后在此提交。</Text>}
        {batches.map((batch) => <Box key={`${batch.id}-${batch.status}-${batch.attempts}`} borderWidth="1px" p="3" mb="2">
          <Flex justify="space-between" align="center">
            <Text fontFamily="mono" fontSize="sm" fontWeight="700">{batch.id}</Text>
            <Badge colorScheme={batchStatusColor[batch.status]}>{batch.status}</Badge>
          </Flex>
          <Text fontSize="xs" color="gray.600" mt="1">{batch.author} · {batch.device} · 离线于 {batch.createdOfflineAt.replace('T', ' ').slice(0, 16)} · {batch.ops.length} 项操作 · 尝试 {batch.attempts} 次</Text>
          <Text fontFamily="mono" fontSize="xs" color="gray.500" mt="1">{batch.contentHash}{batch.mergedVersion ? ` · 已并入 V${batch.mergedVersion}` : ''}</Text>
          {batch.effects.length > 0 && <Box mt="2">{batch.effects.map((effect, index) => <Text key={index} fontSize="xs" color="gray.700">· {effect}</Text>)}</Box>}
          {batch.status === '写入失败' && <Flex mt="2" align="center" gap="2">
            <Text fontSize="xs" color="red.600" flex="1">{batch.lastError}</Text>
            <Button size="xs" colorScheme="red" variant="outline" onClick={() => { const result = state.retryBatch(batch.id); toast({ title: result.message, status: result.ok ? 'success' : 'error' }) }}>重试写入</Button>
          </Flex>}
        </Box>)}
      </Box>
    </Grid>
    {conflicts.length > 0 && <>
      <Divider my="3" />
      <Text fontSize="xs" color="gray.500">冲突留痕 {conflicts.length} 起:{conflicts.map((item) => `${item.id}(${item.factId} ${item.current.conclusion}⇄${item.incoming.conclusion} ${item.status})`).join(' · ')}</Text>
    </>}
  </Box>
}
