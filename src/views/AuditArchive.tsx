import { useState } from 'react'
import { Badge, Box, Button, Flex, Input, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react'
import { useClaimStore } from '../store/useClaimStore'

export function AuditArchive() {
  const state = useClaimStore()
  const [keyword, setKeyword] = useState('')
  const rows = state.audit.filter((item) => `${item.claimId} ${item.action} ${item.operator} ${item.detail}`.toLowerCase().includes(keyword.toLowerCase()))
  const conflicts = state.conflicts ?? []
  const exportAll = () => {
    const payload = { generatedAt: new Date().toISOString(), claims: state.claims, versions: state.versions, audit: state.audit, batches: state.batches, conflicts: state.conflicts }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '事实核查档案与审计.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <Box p="6" pb="16">
    <Flex justify="space-between" align="center" mb="5"><Box><Text fontSize="xs" color="gray.600">主张 / 证据替换 / 批注 / 离线批次 / 发布版本</Text><Text fontSize="xl" fontWeight="700" mt="1">核查档案与审计</Text></Box><Button colorScheme="teal" onClick={exportAll}>导出全部档案</Button></Flex>

    <Box bg="white" borderWidth="1px" p="4" mb="4">
      <Flex justify="space-between" align="center" mb="3"><Text fontWeight="700">结论冲突（同时保留并阻止发布）</Text><Badge colorScheme="red">{conflicts.filter((item) => !item.resolved).length} 项未解决</Badge></Flex>
      {conflicts.length === 0 && <Text fontSize="sm" color="gray.500">暂无结论冲突。离线批次合并产生的冲突会同时保留各方结论并阻止发布，直到编辑解决。</Text>}
      {conflicts.map((conflict) => {
        const claim = state.claims.find((item) => item.id === conflict.claimId)
        const fact = claim?.facts.find((item) => item.id === conflict.factId)
        return <Box key={conflict.id} borderWidth="1px" borderColor={conflict.resolved ? 'green.300' : 'red.300'} bg={conflict.resolved ? 'green.50' : 'red.50'} p="3" mb="2">
          <Flex justify="space-between" align="center">
            <Box><Text fontFamily="mono" fontSize="xs" color="gray.500">{conflict.claimId} · {conflict.factId}</Text><Text fontWeight="600" fontSize="sm" mt="1">{fact?.text ?? '（事实已移除）'}</Text></Box>
            {conflict.resolved ? <Badge colorScheme="green">已解决</Badge> : <Button size="xs" colorScheme="teal" onClick={() => state.resolveMergeConflict(conflict.claimId, conflict.id)}>标记解决</Button>}
          </Flex>
          <Flex mt="2" gap="2" flexWrap="wrap">
            {conflict.proposals.map((proposal, index) => <Box key={index} borderWidth="1px" borderColor="gray.300" bg="white" px="2" py="1" borderRadius="4px"><Text fontSize="xs" fontWeight="700">{proposal.conclusion}</Text><Text fontSize="xs" color="gray.500">{proposal.batchId === '当前结论' ? '当前结论' : `批次 ${proposal.batchId}`} · {proposal.inspector}</Text></Box>)}
          </Flex>
        </Box>
      })}
    </Box>

    <Box bg="white" borderWidth="1px" p="4" mb="4">
      <Text fontWeight="700" mb="3">版本与离线批次合并</Text>
      <Table size="sm"><Thead><Tr><Th>版本</Th><Th>主张</Th><Th>编辑</Th><Th>说明</Th><Th>合并批次</Th><Th>冲突</Th><Th>时间</Th></Tr></Thead><Tbody>
        {state.versions.map((item) => <Tr key={item.id}>
          <Td fontFamily="mono" fontSize="xs">V{item.version}</Td>
          <Td fontFamily="mono" fontSize="xs">{item.claimId}</Td>
          <Td>{item.editor}</Td>
          <Td fontSize="sm">{item.summary}</Td>
          <Td>{(item.mergedBatchIds ?? []).length ? <Flex gap="1" flexWrap="wrap">{item.mergedBatchIds!.map((batchId) => <Badge key={batchId} colorScheme="teal" variant="outline">{batchId}</Badge>)}</Flex> : <Text fontSize="xs" color="gray.400">—</Text>}</Td>
          <Td>{(item.conflictIds ?? []).length ? <Badge colorScheme="red">{item.conflictIds!.length} 项</Badge> : <Text fontSize="xs" color="gray.400">—</Text>}</Td>
          <Td fontSize="xs">{item.createdAt.replace('T', ' ').slice(0, 16)}</Td>
        </Tr>)}
      </Tbody></Table>
    </Box>

    <Flex gap="3" mb="3"><Input maxW="460px" placeholder="搜索主张、动作、操作人或说明" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><Text alignSelf="center" fontSize="xs" color="gray.500">共{rows.length}条不可变审计事件</Text></Flex>
    <Box bg="white" borderWidth="1px"><Table size="sm"><Thead><Tr><Th>时间</Th><Th>主张</Th><Th>动作</Th><Th>操作人</Th><Th>说明</Th></Tr></Thead><Tbody>{rows.map((item) => <Tr key={item.id}><Td fontSize="xs">{item.createdAt.replace('T', ' ').slice(0, 16)}</Td><Td fontFamily="mono" fontSize="xs">{item.claimId}</Td><Td><Badge colorScheme={item.action.includes('相反') || item.action.includes('冲突') ? 'red' : item.action.includes('发布') ? 'green' : item.action.includes('失败') ? 'red' : 'blue'}>{item.action}</Badge></Td><Td>{item.operator}</Td><Td fontSize="sm">{item.detail}</Td></Tr>)}</Tbody></Table></Box>
    <Box mt="5" bg="white" borderWidth="1px" p="4"><Text fontWeight="700">版本差异原则</Text><Text fontSize="sm" color="gray.600" mt="2">被替换证据仍保留在版本记录中；发布版本不能隐藏相反证据、删除原始来源或覆盖既有批注。离线批次合并后按当前全部证据重算置信度与发布阻断，不沿用离线结果；结论冲突同时保留并阻止发布。</Text></Box>
  </Box>
}
