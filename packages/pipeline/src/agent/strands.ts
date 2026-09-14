/**
 * Strands Agents (TypeScript) orchestration of the describe → fit → voice steps.
 * The steps are plain functions so they can run without an agent (CLI/worker) and be tested with fixtures;
 * the agent adds retries, budget awareness and a natural-language log for docs/aws.md.
 *
 * npm: @strands-agents/sdk (TypeScript 1.0, April 2026) — confirm the package name and Bedrock default model in DESC-003.
 *
 * Sketch:
 *   import { Agent, tool } from '@strands-agents/sdk'
 *   const agent = new Agent({ model: 'amazon.nova-lite-v1:0', tools: [describeShotTool, fitTool, voiceTool], systemPrompt: '...' })
 *   await agent.invoke(`Describe title ${slug}: ${shots.length} shots, ${gaps.length} gaps. Budget $1.`)
 */
export {}
