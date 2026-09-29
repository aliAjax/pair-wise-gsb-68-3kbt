import { useState } from 'react'
import { Badge, Box, Button, Flex, Input, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react'
import { batchStatusColor, conclusionColor, useClaimStore } from '../store/useClaimStore'

export function AuditArchive() {
  const state = useClaimStore()
  const [keyword, setKeyword] = useState('')
  const rows = state.audit.filter((item) => `${item.claimId} ${item.action} ${item.operator} ${item.detail}`.toLowerCase().includes(keyword.toLowerCase()))
  const exportAll = () => {
    const payload = { generatedAt: new Date().toISOString(), claims: state.claims, versions: state.versions, batches: state.batches, conflicts: state.conflicts, audit: state.audit }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '事实核查档案与审计.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <Box p="6" pb="16">
    <Flex justify="space-between" align="center" mb="5"><Box><Text fontSize="xs" color="gray.600">主张 / 证据替换 / 批注 / 发布版本 / 离线合并</Text><Text fontSize="xl" fontWeight="700" mt="1">核查档案与审计</Text></Box><Button colorScheme="teal" onClick={exportAll}>导出全部档案</Button></Flex>

    <Box bg="white" borderWidth="1px" p="4" mb="5">
      <Flex justify="space-between" align="center" mb="3"><Text fontWeight="700">版本合并记录</Text><Text fontSize="xs" color="gray.500">每个版本合并了哪些离线批次、产生了哪些结论冲突</Text></Flex>
      {state.versions.map((version) => {
        const batches = (version.mergedBatchIds ?? []).map((id) => state.batches.find((batch) => batch.id === id)).filter((batch) => batch !== undefined)
        const conflicts = (version.conflictIds ?? []).map((id) => state.conflicts.find((conflict) => conflict.id === id)).filter((conflict) => conflict !== undefined)
        return <Box key={version.id} borderWidth="1px" p="3" mb="2">
          <Flex justify="space-between" align="center">
            <Text fontWeight="700" fontSize="sm">{version.claimId} · V{version.version} <Text as="span" fontWeight="400" color="gray.600">· {version.editor} · {version.createdAt.replace('T', ' ').slice(0, 16)}</Text></Text>
            <Flex gap="1">{batches.length > 0 && <Badge colorScheme="teal">合并 {batches.length} 批</Badge>}{conflicts.length > 0 && <Badge colorScheme="red">冲突 {conflicts.length} 起</Badge>}{batches.length === 0 && conflicts.length === 0 && <Badge>在线编辑</Badge>}</Flex>
          </Flex>
          <Text fontSize="sm" color="gray.700" mt="1">{version.summary}</Text>
          {batches.map((batch) => <Box key={batch.id} mt="2" pl="3" borderLeftWidth="2px" borderColor="teal.300">
            <Flex gap="2" align="center"><Text fontFamily="mono" fontSize="xs" fontWeight="700">{batch.id}</Text><Badge colorScheme={batchStatusColor[batch.status]}>{batch.status}</Badge><Text fontSize="xs" color="gray.500">{batch.author} · {batch.device} · {batch.ops.length} 项操作 · 哈希 {batch.contentHash}</Text></Flex>
            {batch.effects.map((effect, index) => <Text key={index} fontSize="xs" color="gray.600" pl="2">· {effect}</Text>)}
          </Box>)}
          {conflicts.map((conflict) => <Flex key={conflict.id} mt="2" pl="3" borderLeftWidth="2px" borderColor="red.300" gap="2" align="center" flexWrap="wrap">
            <Text fontFamily="mono" fontSize="xs" fontWeight="700">{conflict.id}</Text>
            <Text fontSize="xs" color="gray.600">{conflict.factId}</Text>
            <Badge colorScheme={conclusionColor[conflict.current.conclusion]}>{conflict.current.conclusion}</Badge>
            <Text fontSize="xs">⇄</Text>
            <Badge colorScheme={conclusionColor[conflict.incoming.conclusion]}>{conflict.incoming.conclusion}</Badge>
            <Text fontSize="xs" color="gray.500">批次 {conflict.incoming.batchId} · {conflict.status}{conflict.resolution ? `:${conflict.resolution}` : ''}</Text>
          </Flex>)}
        </Box>
      })}
    </Box>

    <Box bg="white" borderWidth="1px" mb="5">
      <Flex justify="space-between" align="center" p="4" pb="2"><Text fontWeight="700">离线批次暂存箱</Text><Text fontSize="xs" color="gray.500">写入失败的批次保留待重试,已成功批次不会丢失</Text></Flex>
      <Table size="sm"><Thead><Tr><Th>批次号</Th><Th>主张</Th><Th>作者 / 设备</Th><Th>内容哈希</Th><Th>操作</Th><Th>状态</Th><Th>尝试</Th><Th>并入版本</Th></Tr></Thead><Tbody>
        {state.batches.map((batch) => <Tr key={`${batch.id}-${batch.status}-${batch.attempts}`}>
          <Td fontFamily="mono" fontSize="xs">{batch.id}</Td><Td fontFamily="mono" fontSize="xs">{batch.claimId}</Td>
          <Td fontSize="xs">{batch.author} · {batch.device}</Td><Td fontFamily="mono" fontSize="xs">{batch.contentHash}</Td>
          <Td>{batch.ops.length}</Td><Td><Badge colorScheme={batchStatusColor[batch.status]}>{batch.status}</Badge></Td>
          <Td>{batch.attempts}</Td><Td fontSize="xs">{batch.mergedVersion ? `V${batch.mergedVersion}` : batch.lastError ?? '—'}</Td>
        </Tr>)}
      </Tbody></Table>
    </Box>

    <Flex gap="3" mb="3"><Input maxW="460px" placeholder="搜索主张、动作、操作人或说明" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><Text alignSelf="center" fontSize="xs" color="gray.500">共{rows.length}条不可变审计事件</Text></Flex>
    <Box bg="white" borderWidth="1px"><Table size="sm"><Thead><Tr><Th>时间</Th><Th>主张</Th><Th>动作</Th><Th>操作人</Th><Th>说明</Th></Tr></Thead><Tbody>{rows.map((item) => <Tr key={item.id}><Td fontSize="xs">{item.createdAt.replace('T', ' ').slice(0, 16)}</Td><Td fontFamily="mono" fontSize="xs">{item.claimId}</Td><Td><Badge colorScheme={item.action.includes('相反') ? 'red' : item.action.includes('发布') ? 'green' : item.action.includes('批次') || item.action.includes('冲突') ? 'purple' : 'blue'}>{item.action}</Badge></Td><Td>{item.operator}</Td><Td fontSize="sm">{item.detail}</Td></Tr>)}</Tbody></Table></Box>
    <Box mt="5" bg="white" borderWidth="1px" p="4"><Text fontWeight="700">版本差异原则</Text><Text fontSize="sm" color="gray.600" mt="2">被替换与撤回的证据仍保留在版本记录中;发布版本不能隐藏相反证据、删除原始来源或覆盖既有批注;离线批次按内容哈希归并,结论冲突双方同时保留,裁定前阻断发布。</Text></Box>
  </Box>
}
