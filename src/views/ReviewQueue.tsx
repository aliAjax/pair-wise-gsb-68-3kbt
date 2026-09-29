import { Badge, Box, Button, Flex, Text, useToast } from '@chakra-ui/react'
import { computePublishBlockers } from '../services/offlineMerge'
import { useClaimStore } from '../store/useClaimStore'

export function ReviewQueue() {
  const state = useClaimStore()
  const toast = useToast()
  const reviewClaims = state.claims.filter((claim) => claim.status === '待编辑复核' || claim.facts.some((fact) => fact.annotations.some((note) => !note.resolved)))
  const approve = (claimId: string) => {
    const result = state.transitionClaim(claimId, '已发布', '编辑完成事实、来源与相反证据复核。')
    toast({ title: result.message, status: result.ok ? 'success' : 'error' })
  }
  return <Box p="6" pb="16">
    <Box mb="5"><Text fontSize="xs" color="gray.600">编辑审阅 / 争议证据 / 发布前检查</Text><Text fontSize="xl" fontWeight="700" mt="1">复核队列</Text></Box>
    <Flex direction="column" gap="3">{reviewClaims.map((claim) => {
      const unresolved = claim.facts.flatMap((fact) => fact.annotations.filter((note) => !note.resolved).map((note) => ({ fact, note })))
      const blockers = computePublishBlockers(claim, state.conflicts)
      const openConflicts = state.conflicts.filter((item) => item.claimId === claim.id && item.status === '待裁定')
      return <Box key={claim.id} bg="white" borderWidth="1px" p="4">
        <Flex justify="space-between"><Box><Text fontFamily="mono" fontSize="xs" color="gray.500">{claim.id}</Text><Text fontWeight="700" mt="1">{claim.title}</Text></Box><Badge colorScheme="orange">{claim.status}</Badge></Flex>
        <Flex mt="4" gap="4"><Box flex="1"><Text fontSize="sm" fontWeight="600">未解决批注 {unresolved.length}</Text>{unresolved.map(({ fact, note }) => <Box key={note.id} bg="orange.50" p="2" mt="2"><Text fontSize="xs" color="gray.500">{fact.id} · {note.author}</Text><Text fontSize="sm">{note.content}</Text></Box>)}</Box><Box flex="1"><Text fontSize="sm" fontWeight="600">发布阻断 {blockers.length}(按当前全部证据实时重算)</Text>{blockers.map((reason, index) => <Box key={index} bg="red.50" p="2" mt="2"><Text fontSize="sm">{reason}</Text></Box>)}</Box></Flex>
        {openConflicts.length > 0 && <Box mt="3" bg="red.50" borderWidth="1px" borderColor="red.200" p="3">
          <Text fontSize="sm" fontWeight="600">待裁定结论冲突 {openConflicts.length} 起(双方结论均已保留)</Text>
          {openConflicts.map((conflict) => <Text key={conflict.id} fontSize="sm" mt="1">{conflict.factId}:工作台「{conflict.current.conclusion}」⇄ 批次 {conflict.incoming.batchId}「{conflict.incoming.conclusion}」,裁定前不得发布</Text>)}
        </Box>}
        {blockers.length > 0 && <Button mt="4" size="sm" colorScheme="teal" isDisabled onClick={() => approve(claim.id)}>发布前校验未通过</Button>}
        {blockers.length === 0 && <Button mt="4" size="sm" colorScheme="teal" onClick={() => approve(claim.id)}>批准发布并锁定版本</Button>}
      </Box>
    })}</Flex>
  </Box>
}
