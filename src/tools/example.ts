/**
 * Example: Using Agent Builder Tools
 *
 * This shows how to use the create_graph and create_html_node tools
 * in an agent execution loop.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAllTools, executeTool, formatToolResultForClaude } from './index';

// Example agent configuration
const agentConfig = {
  userId: 'user_demo',
  systemPrompt: `You are a research agent that builds knowledge graphs.
When given a topic, create a structured knowledge graph with relevant HTML nodes for examples and code.`,
  model: 'claude-sonnet-4-5' as const,
  temperature: 0.7,
  maxTokens: 4096
};

/**
 * Run an agent with KG tools
 */
export async function runAgentWithTools(
  userRequest: string,
  anthropicApiKey: string
) {
  const client = new Anthropic({ apiKey: anthropicApiKey });

  // Get all available tools
  const tools = getAllTools();

  // Initialize conversation
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: userRequest
    }
  ];

  let turn = 0;
  const maxTurns = 20;

  console.log('🤖 Agent Starting...\n');

  while (turn < maxTurns) {
    turn++;
    console.log(`\n--- Turn ${turn} ---`);

    // Call Claude API
    const response = await client.messages.create({
      model: agentConfig.model,
      max_tokens: agentConfig.maxTokens,
      temperature: agentConfig.temperature,
      system: agentConfig.systemPrompt,
      tools: tools,
      messages: messages
    });

    // Check stop reason
    if (response.stop_reason === 'end_turn') {
      // Agent finished
      console.log('\n✅ Agent Complete\n');
      const textContent = response.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        console.log(textContent.text);
      }
      break;
    }

    if (response.stop_reason === 'tool_use') {
      // Agent wants to use tools
      const toolUses = response.content.filter((c) => c.type === 'tool_use');

      console.log(`🔧 Agent calling ${toolUses.length} tool(s):`);
      for (const toolUse of toolUses) {
        if (toolUse.type === 'tool_use') {
          console.log(`   - ${toolUse.name}`);
        }
      }

      // Execute tools and collect results
      const toolResults: Anthropic.MessageParam = {
        role: 'user',
        content: []
      };

      for (const toolUse of toolUses) {
        if (toolUse.type === 'tool_use') {
          console.log(`\n   Executing: ${toolUse.name}`);

          // Execute the tool
          const result = await executeTool(toolUse.name, toolUse.input, {
            userId: agentConfig.userId
          });

          // Format result for Claude
          const formattedResult = formatToolResultForClaude(result);

          console.log(`   Result: ${result.success ? '✓' : '✗'}`);
          if (result.data) {
            console.log(`   ${JSON.stringify(result.data, null, 2)}`);
          }

          // Add to tool results
          (toolResults.content as any[]).push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: formattedResult
          });
        }
      }

      // Add assistant message and tool results to conversation
      messages.push(
        { role: 'assistant', content: response.content },
        toolResults
      );
    } else {
      // Unexpected stop reason
      console.log(`\n⚠️ Unexpected stop reason: ${response.stop_reason}`);
      break;
    }
  }

  if (turn >= maxTurns) {
    console.log('\n⚠️ Max turns reached');
  }
}

/**
 * Example usage
 */
async function example() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Please set ANTHROPIC_API_KEY environment variable');
    return;
  }

  await runAgentWithTools(
    'Create a knowledge graph about TypeScript best practices. Include an HTML node with a code example.',
    apiKey
  );
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}
