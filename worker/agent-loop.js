/**
 * Agent loop — streaming and non-streaming execution loops
 *
 * streamingAgentLoop: SSE-based for /chat endpoint
 * executeAgent: log-based for /execute endpoint
 */

import { TOOL_DEFINITIONS, WEB_SEARCH_TOOL } from './tool-definitions.js'
import { loadOpenAPITools } from './openapi-tools.js'
import { executeTool } from './tool-executors.js'

/**
 * Load and merge all tools: hardcoded + OpenAPI dynamic + web_search
 */
async function loadAllTools(env) {
  let openAPITools = []
  let operationMap = {}
  try {
    const loaded = await loadOpenAPITools(env)
    openAPITools = loaded.tools
    operationMap = loaded.operationMap
  } catch (err) {
    console.error('Failed to load OpenAPI tools:', err)
  }

  const hardcodedNames = new Set(TOOL_DEFINITIONS.map(t => t.name))
  const dynamicTools = openAPITools.filter(t => !hardcodedNames.has(t.name))
  const allTools = [...TOOL_DEFINITIONS, ...dynamicTools, WEB_SEARCH_TOOL]

  return { allTools, operationMap }
}

/**
 * Truncate large tool results to prevent context window overflow
 */
function truncateResult(result) {
  let resultStr = JSON.stringify(result)
  const MAX_RESULT_SIZE = 12000
  if (resultStr.length > MAX_RESULT_SIZE) {
    const truncated = JSON.parse(resultStr)
    if (truncated.nodes) {
      truncated.nodes = truncated.nodes.map(n => ({
        ...n,
        info: n.info && n.info.length > 300 ? n.info.slice(0, 300) + '... [truncated]' : n.info,
      }))
    }
    resultStr = JSON.stringify(truncated)
    if (resultStr.length > MAX_RESULT_SIZE) {
      resultStr = resultStr.slice(0, MAX_RESULT_SIZE) + '... [truncated — result too large]'
    }
  }
  return resultStr
}

/**
 * Streaming agent loop — writes SSE events to a TransformStream writer
 */
async function streamingAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options) {
  const maxTurns = options.maxTurns || 8
  const model = options.model || 'claude-haiku-4-5-20251001'
  let turn = 0
  const startTime = Date.now()

  const log = (msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[agent-loop +${elapsed}s] ${msg}`)
  }

  const { allTools, operationMap } = await loadAllTools(env)
  log(`started | model=${model} maxTurns=${maxTurns} tools=${allTools.length} userId=${userId?.slice(0,8)}...`)

  try {
    while (turn < maxTurns) {
      turn++
      log(`turn ${turn}/${maxTurns} — calling Anthropic`)
      writer.write(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ turn })}\n\n`))

      const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          messages,
          model,
          max_tokens: 16384,
          temperature: 0.3,
          system: systemPrompt,
          tools: allTools,
        }),
      })

      const data = await response.json()
      log(`turn ${turn} response: status=${response.status} stop_reason=${data.stop_reason} content_blocks=${(data.content||[]).length}`)

      if (!response.ok) {
        log(`ERROR: Anthropic API error — ${JSON.stringify(data.error || 'unknown')}`)
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: data.error || 'Anthropic API error' })}\n\n`))
        break
      }

      if (data.stop_reason === 'end_turn') {
        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        const textLen = textBlocks.reduce((sum, b) => sum + b.text.length, 0)
        log(`end_turn — ${textBlocks.length} text blocks (${textLen} chars)`)
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        // Generate follow-up suggestions using a fast Haiku call
        try {
          const lastAssistantText = textBlocks.map(b => b.text).join('\n')
          const recentContext = messages.slice(-4).map(m => {
            let content
            if (typeof m.content === 'string') {
              content = m.content
            } else if (Array.isArray(m.content)) {
              content = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
              const imgCount = m.content.filter(b => b.type === 'image').length
              if (imgCount > 0) content = `[${imgCount} image(s)] ${content}`
            } else {
              content = JSON.stringify(m.content)
            }
            return `${m.role}: ${content.slice(0, 300)}`
          }).join('\n')

          const suggestRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              messages: [{
                role: 'user',
                content: `Based on this conversation context and the assistant's last response, suggest exactly 3 short follow-up prompts the user might want to ask next. Each should be a natural next step, question, or action. Return ONLY a JSON array of 3 strings, no explanation.\n\nRecent conversation:\n${recentContext}\n\nAssistant's response:\n${lastAssistantText.slice(0, 500)}`
              }],
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 256,
              temperature: 0.7,
            }),
          })

          if (suggestRes.ok) {
            const suggestData = await suggestRes.json()
            const suggestText = (suggestData.content || []).find(c => c.type === 'text')?.text || ''
            const jsonMatch = suggestText.match(/\[[\s\S]*\]/)
            if (jsonMatch) {
              const suggestions = JSON.parse(jsonMatch[0])
              if (Array.isArray(suggestions) && suggestions.length > 0) {
                const cleaned = suggestions.slice(0, 3).map(s => String(s).trim()).filter(s => s.length > 0)
                if (cleaned.length > 0) {
                  log(`suggestions generated: ${cleaned.length}`)
                  writer.write(encoder.encode(`event: suggestions\ndata: ${JSON.stringify({ suggestions: cleaned })}\n\n`))
                }
              }
            }
          }
        } catch (sugErr) {
          log(`suggestions generation failed (non-fatal): ${sugErr.message}`)
        }

        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn })}\n\n`))
        break
      }

      if (data.stop_reason === 'tool_use') {
        const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
        const textBlocks = (data.content || []).filter(c => c.type === 'text')

        log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        const graphTools = toolUses.filter(t => t.name === 'create_graph')
        const otherTools = toolUses.filter(t => t.name !== 'create_graph')

        const executeAndStream = async (toolUse) => {
          const toolStart = Date.now()
          log(`executing ${toolUse.name} (input: ${JSON.stringify(toolUse.input).slice(0, 200)})`)
          writer.write(encoder.encode(`event: tool_call\ndata: ${JSON.stringify({ tool: toolUse.name, input: toolUse.input })}\n\n`))
          // Progress callback for long-running tools
          const onProgress = (msg) => {
            writer.write(encoder.encode(`event: tool_progress\ndata: ${JSON.stringify({ tool: toolUse.name, message: msg })}\n\n`))
          }
          try {
            const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, operationMap, onProgress)
            const summary = result.message || `${toolUse.name} completed`
            const resultLen = JSON.stringify(result).length
            log(`${toolUse.name} OK (${((Date.now() - toolStart) / 1000).toFixed(1)}s, ${resultLen} chars)`)
            const ssePayload = { tool: toolUse.name, success: true, summary }
            // Pass clientSideRequired data to frontend so it can handle transcription
            if (result.clientSideRequired) {
              ssePayload.clientSideRequired = true
              ssePayload.audioUrl = result.audioUrl
              ssePayload.language = result.language
              ssePayload.recordingId = result.recordingId
              ssePayload.saveToGraph = result.saveToGraph || false
              ssePayload.graphTitle = result.graphTitle || null
            }
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify(ssePayload)}\n\n`))
            const resultStr = truncateResult(result)
            return { type: 'tool_result', tool_use_id: toolUse.id, content: resultStr }
          } catch (error) {
            log(`${toolUse.name} FAILED (${((Date.now() - toolStart) / 1000).toFixed(1)}s): ${error.message}`)
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ tool: toolUse.name, success: false, error: error.message })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
          }
        }

        const phase1Results = await Promise.all(graphTools.map(executeAndStream))
        const phase2Results = await Promise.all(otherTools.map(executeAndStream))
        const toolResults = [...phase1Results, ...phase2Results]

        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: toolResults },
        )
      } else if (data.stop_reason === 'max_tokens') {
        log(`max_tokens hit on turn ${turn} — sending continuation`)
        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'Continue. Do not repeat what you already said.' },
        )
      } else {
        log(`unexpected stop_reason: ${data.stop_reason}`)
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Unexpected stop: ' + data.stop_reason })}\n\n`))
        break
      }
    }

    if (turn >= maxTurns) {
      log(`max turns reached (${maxTurns})`)
      writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, maxReached: true })}\n\n`))
    }
  } catch (err) {
    log(`FATAL ERROR: ${err.message}\n${err.stack}`)
    writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`))
  } finally {
    log(`stream closed — ${turn} turns, ${((Date.now() - startTime) / 1000).toFixed(1)}s total`)
    writer.close()
  }
}

/**
 * Execute agent with task (non-streaming, returns execution log)
 */
async function executeAgent(agentConfig, userTask, userId, env) {
  let taskWithContract = userTask
  if (agentConfig.default_contract_id) {
    taskWithContract = `${userTask}\n\n[Default contract: ${agentConfig.default_contract_id}]`
  }

  const messages = [{ role: 'user', content: taskWithContract }]

  const { allTools, operationMap } = await loadAllTools(env)

  const executionLog = []
  let turn = 0
  const maxTurns = agentConfig.max_turns || 5

  while (turn < maxTurns) {
    turn++

    executionLog.push({
      turn,
      type: 'agent_thinking',
      timestamp: new Date().toISOString()
    })

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        messages: messages,
        model: agentConfig.model || 'claude-haiku-4-5-20251001',
        max_tokens: agentConfig.max_tokens || 4096,
        temperature: agentConfig.temperature ?? 0.3,
        system: agentConfig.system_prompt,
        tools: allTools
      })
    })

    const data = await response.json()

    if (!response.ok) {
      executionLog.push({
        turn,
        type: 'error',
        error: data.error || 'Anthropic API error',
        timestamp: new Date().toISOString()
      })
      break
    }

    if (data.stop_reason === 'end_turn') {
      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      const textContent = data.content.find(c => c.type === 'text')
      executionLog.push({
        turn,
        type: 'agent_complete',
        response: textContent ? textContent.text : '',
        timestamp: new Date().toISOString()
      })
      break
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(c => c.type === 'tool_use')
      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')

      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      if (toolUses.length > 0) {
        executionLog.push({
          turn,
          type: 'tool_calls',
          tools: toolUses.map(t => ({ name: t.name, input: t.input })),
          timestamp: new Date().toISOString()
        })
      }

      const graphTools = toolUses.filter(t => t.name === 'create_graph')
      const otherTools = toolUses.filter(t => t.name !== 'create_graph')

      const phase1Results = await Promise.all(graphTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, operationMap)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: true, result, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        } catch (error) {
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
        }
      }))

      const phase2Results = await Promise.all(otherTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, operationMap)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: true, result, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        } catch (error) {
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
        }
      }))

      const toolResults = [...phase1Results, ...phase2Results]

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults }
      )
    } else if (data.stop_reason === 'pause_turn') {
      executionLog.push({
        turn,
        type: 'pause_turn',
        timestamp: new Date().toISOString()
      })

      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue.' }
      )
    } else if (data.stop_reason === 'max_tokens') {
      executionLog.push({
        turn,
        type: 'max_tokens_continuation',
        timestamp: new Date().toISOString()
      })

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'You hit the token limit. Do NOT repeat what you already said. Continue by making your next tool call (create_node, add_edge, etc.) to finish the task.' }
      )
    } else {
      executionLog.push({
        turn,
        type: 'unexpected_stop',
        stop_reason: data.stop_reason,
        timestamp: new Date().toISOString()
      })
      break
    }
  }

  if (turn >= maxTurns) {
    executionLog.push({
      type: 'max_turns_reached',
      timestamp: new Date().toISOString()
    })
  }

  return {
    success: turn < maxTurns,
    turns: turn,
    executionLog: executionLog
  }
}

export { streamingAgentLoop, executeAgent }
