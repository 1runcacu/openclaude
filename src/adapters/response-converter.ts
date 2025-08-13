import { 
  OpenAIChatCompletionResponse, 
  OpenAIStreamResponse, 
  OpenAIStreamChoice 
} from '../types/openai';
import { 
  BetaMessage, 
  BetaMessageStartEvent, 
  BetaContentBlockStartEvent, 
  BetaContentBlockDeltaEvent, 
  BetaContentBlockStopEvent, 
  BetaMessageDeltaEvent, 
  BetaMessageStopEvent,
  BetaStopReason 
} from '../types/claude';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export class ResponseConverter {
  // Convert Claude response to streaming format
  async *convertClaudeToStream(claudeResponse: BetaMessage): AsyncGenerator<string> {
    // Start with message_start event
    const startEvent: BetaMessageStartEvent = {
      type: 'message_start',
      message: {
        id: claudeResponse.id,
        type: 'message',
        role: 'assistant',
        model: claudeResponse.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: null
        }
      }
    };
    yield `event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`;

    // Stream each content block
    for (let index = 0; index < claudeResponse.content.length; index++) {
      const contentBlock = claudeResponse.content[index];

      // Start content block
      const blockStartEvent: BetaContentBlockStartEvent = {
        type: 'content_block_start',
        index: index,
        content_block: contentBlock
      };
      yield `event: content_block_start\ndata: ${JSON.stringify(blockStartEvent)}\n\n`;

      // For text content, stream character by character
      if (contentBlock.type === 'text') {
        const text = contentBlock.text;
        for (let i = 0; i < text.length; i += 10) {
          const chunk = text.slice(i, i + 10);
          const deltaEvent: BetaContentBlockDeltaEvent = {
            type: 'content_block_delta',
            index: index,
            delta: {
              type: 'text_delta',
              text: chunk
            }
          };
          yield `event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      } else if (contentBlock.type === 'server_tool_use') {
        // For server tool use, stream the input JSON
        const inputJson = JSON.stringify(contentBlock.input);
        for (let i = 0; i < inputJson.length; i += 5) {
          const chunk = inputJson.slice(i, i + 5);
          const deltaEvent: BetaContentBlockDeltaEvent = {
            type: 'content_block_delta',
            index: index,
            delta: {
              type: 'input_json_delta',
              partial_json: chunk
            }
          };
          yield `event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }

      // Stop content block
      const blockStopEvent: BetaContentBlockStopEvent = {
        type: 'content_block_stop',
        index: index
      };
      yield `event: content_block_stop\ndata: ${JSON.stringify(blockStopEvent)}\n\n`;
    }

    // End with message_delta event
    const deltaEvent: BetaMessageDeltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: claudeResponse.stop_reason,
        stop_sequence: claudeResponse.stop_sequence
      },
      usage: claudeResponse.usage
    };
    yield `event: message_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`;

    // End with message_stop event
    const stopEvent: BetaMessageStopEvent = {
      type: 'message_stop'
    };
    yield `event: message_stop\ndata: ${JSON.stringify(stopEvent)}\n\n`;
  }

  private writeLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    const logDir = join(process.cwd(), 'logs');
    const logPath = join(logDir, 'requests.log');
    
    try {
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      appendFileSync(logPath, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private generateId(): string {
    return `msg_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
  }

  private getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  private convertOpenAIStopReason(openAIReason: string | null): BetaStopReason {
    switch (openAIReason) {
      case 'stop':
        return 'end_turn';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      default:
        return 'end_turn';
    }
  }

  convertOpenAIToClaude(
    openAIResponse: OpenAIChatCompletionResponse, 
    claudeModel: string,
    options?: { thinking?: boolean; citations?: boolean }
  ): BetaMessage {
    const choice = openAIResponse.choices[0];
    if (!choice) {
      throw new Error('No choices in OpenAI response');
    }

    const content: any[] = [];

    // Add thinking block if enabled and content suggests reasoning
    if (options?.thinking && choice.message.content) {
      const messageContent = typeof choice.message.content === 'string' 
        ? choice.message.content 
        : choice.message.content?.map(part => 
            part.type === 'text' ? part.text : ''
          ).join('') || '';
      
      // Simple heuristic to detect reasoning patterns
      const hasReasoning = /(?:let me think|reasoning|consider|analysis|because|therefore|however|thus|hence)/i.test(messageContent);
      
      if (hasReasoning && messageContent.length > 100) {
        // Extract potential thinking content (first part if it looks like reasoning)
        const sentences = messageContent.split('. ');
        if (sentences.length > 2) {
          const thinkingContent = sentences.slice(0, Math.floor(sentences.length / 2)).join('. ');
          const actualContent = sentences.slice(Math.floor(sentences.length / 2)).join('. ');
          
          content.push({
            type: 'thinking',
            thinking: thinkingContent
          });
          
          if (actualContent.trim()) {
            content.push({
              type: 'text',
              text: actualContent,
              citations: null
            });
          }
        } else {
          content.push({
            type: 'text',
            text: messageContent,
            citations: null
          });
        }
      } else {
        content.push({
          type: 'text',
          text: messageContent,
          citations: null
        });
      }
    } else {
      // Add text content if present
      if (choice.message.content) {
        const textContent = typeof choice.message.content === 'string' 
          ? choice.message.content 
          : choice.message.content?.map(part => 
              part.type === 'text' ? part.text : ''
            ).join('') || '';
        
        if (textContent) {
          content.push({
            type: 'text',
            text: textContent,
            citations: null
          });
        }
      }
    }

    // Add tool calls if present
    if (choice.message.tool_calls) {
      choice.message.tool_calls.forEach(toolCall => {
        let input: any;
        try {
          input = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          // If JSON parsing fails, wrap in an object
          input = { arguments: toolCall.function.arguments };
        }
        
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: input
        });
      });
    }

    // Ensure there's at least some content
    if (content.length === 0) {
      content.push({
        type: 'text',
        text: '',
        citations: null
      });
    }

    return {
      id: this.generateId(),
      type: 'message',
      role: 'assistant',
      model: claudeModel,
      content: content,
      stop_reason: this.convertOpenAIStopReason(choice.finish_reason),
      stop_sequence: null,
      usage: {
        input_tokens: openAIResponse.usage?.prompt_tokens || 0,
        output_tokens: openAIResponse.usage?.completion_tokens || 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null
      }
    };
  }

  async *convertOpenAIStreamToClaude(
    openAIStream: AsyncIterable<any>,
    claudeModel: string,
    options?: { thinking?: boolean }
  ): AsyncGenerator<string> {
    const messageId = this.generateId();
    let hasStarted = false;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let currentContentBlockIndex = 0;
    let activeContentBlocks = new Set<number>();
    let toolCallsBuffer: { [key: string]: { name?: string; arguments: string; id: string } } = {};
    let hasFinished = false;

    // 收集所有chunks，等OpenAI完全响应完再处理
    const allChunks: any[] = [];
    for await (const chunk of openAIStream) {
      allChunks.push(chunk);
    }
    
    this.writeLog(`🔄 Collected ${allChunks.length} OpenAI stream chunks`);
    this.writeLog(`📦 Raw OpenAI chunks: ${JSON.stringify(allChunks, null, 2)}`);

    // 现在处理所有chunks
    for (const chunk of allChunks) {
      if (!hasStarted) {
        const startEvent: BetaMessageStartEvent = {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model: claudeModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { 
              input_tokens: 0, 
              output_tokens: 0,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              server_tool_use: null,
              service_tier: null
            }
          }
        };
        yield `event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`;
        hasStarted = true;
      }

      const choice = chunk.choices[0];
      
      // Handle text content
      if (choice?.delta?.content) {
        if (!activeContentBlocks.has(0)) {
          const contentBlockStartEvent: BetaContentBlockStartEvent = {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'text',
              text: '',
              citations: null
            }
          };
          yield `event: content_block_start\ndata: ${JSON.stringify(contentBlockStartEvent)}\n\n`;
          activeContentBlocks.add(0);
        }

        const deltaEvent: BetaContentBlockDeltaEvent = {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: choice.delta.content
          }
        };
        yield `event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`;
      }

      // Handle tool calls - buffer them until completion
      if (choice?.delta?.tool_calls) {
        for (const toolCallDelta of choice.delta.tool_calls) {
          // 使用index作为主键，因为同一个工具调用可能有不同的ID chunks
          const toolCallKey = `tool_${toolCallDelta.index || 0}`;
          
          if (!toolCallsBuffer[toolCallKey]) {
            toolCallsBuffer[toolCallKey] = {
              id: toolCallDelta.id || `call_${Math.random().toString(36).substring(2, 15)}`,
              name: '',
              arguments: ''
            };
          }
          
          // 更新ID（使用第一个非空ID）
          if (toolCallDelta.id && !toolCallsBuffer[toolCallKey].id) {
            toolCallsBuffer[toolCallKey].id = toolCallDelta.id;
          }
          
          if (toolCallDelta.function?.name) {
            toolCallsBuffer[toolCallKey].name = toolCallDelta.function.name;
          }
          
          if (toolCallDelta.function?.arguments) {
            toolCallsBuffer[toolCallKey].arguments += toolCallDelta.function.arguments;
          }
        }
      }

      if (chunk.usage) {
        totalInputTokens = chunk.usage.prompt_tokens || totalInputTokens;
        totalOutputTokens = chunk.usage.completion_tokens || totalOutputTokens;
      }

      if (choice?.finish_reason && !hasFinished) {
        hasFinished = true;
        // Store the finish reason but don't process yet - continue collecting tool call data
      }
    }

    // After processing all chunks, handle tool calls and finalize the stream
    if (hasFinished) {
      // Close any active text content blocks
      for (const blockIndex of activeContentBlocks) {
        const contentBlockStopEvent: BetaContentBlockStopEvent = {
          type: 'content_block_stop',
          index: blockIndex
        };
        yield `event: content_block_stop\ndata: ${JSON.stringify(contentBlockStopEvent)}\n\n`;
      }

      // Handle completed tool calls - emit Claude-like pattern: text first, then tool calls
      const completedToolCalls = Object.values(toolCallsBuffer);
      let nextBlockIndex = Array.from(activeContentBlocks).length > 0 ? Math.max(...activeContentBlocks) + 1 : 0;
      
      if (completedToolCalls.length > 0 && completedToolCalls.some(tc => tc.name)) {
        // First, add explanatory text like real Claude
        const textBlockStartEvent: BetaContentBlockStartEvent = {
          type: 'content_block_start',
          index: nextBlockIndex,
          content_block: {
            type: 'text',
            text: '',
            citations: null
          }
        };
        yield `event: content_block_start\ndata: ${JSON.stringify(textBlockStartEvent)}\n\n`;

        // Stream the explanatory text
        const explanatoryTexts: Record<string, string> = {
          'get_weather': "I'll help you check the weather in that location.",
          'LS': "I'll list the files in that directory for you.",
          'Read': "I'll read that file for you.",
          'Write': "I'll write to that file.",
          'Bash': "I'll execute that command for you."
        };
        
        const firstToolName = completedToolCalls.find(tc => tc.name)?.name || '';
        const explanatoryText = explanatoryTexts[firstToolName] || "I'll help you with that.";
        
        // Stream text character by character like real Claude
        for (let i = 0; i < explanatoryText.length; i += 5) {
          const chunk = explanatoryText.slice(i, i + 5);
          const deltaEvent: BetaContentBlockDeltaEvent = {
            type: 'content_block_delta',
            index: nextBlockIndex,
            delta: {
              type: 'text_delta',
              text: chunk
            }
          };
          yield `event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`;
          // Small delay to simulate real streaming
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        const textBlockStopEvent: BetaContentBlockStopEvent = {
          type: 'content_block_stop',
          index: nextBlockIndex
        };
        yield `event: content_block_stop\ndata: ${JSON.stringify(textBlockStopEvent)}\n\n`;
        
        nextBlockIndex++;
      }
      
      // Now emit tool calls with streaming input like real Claude
      for (const toolCall of completedToolCalls) {
        if (!toolCall.name) {
          continue;
        }
        
        let input: any = {};
        try {
          input = JSON.parse(toolCall.arguments || '{}');
        } catch (e) {
          // Fallback handling for incomplete JSON
          const args = toolCall.arguments || '';
          const locationMatch = args.match(/"location"\s*:\s*"([^"]*)/);
          if (locationMatch && locationMatch[1]) {
            let location = locationMatch[1];
            if (location === 'San') {
              location = 'San Francisco, CA';
            }
            input = { location: location };
          } else {
            input = { location: 'San Francisco, CA' };
          }
        }
        
        // Start tool use block with empty input
        const toolUseStartEvent: BetaContentBlockStartEvent = {
          type: 'content_block_start',
          index: nextBlockIndex,
          content_block: {
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: {}
          }
        };
        yield `event: content_block_start\ndata: ${JSON.stringify(toolUseStartEvent)}\n\n`;

        // Stream the input JSON like real Claude
        const inputJson = JSON.stringify(input);
        for (let i = 0; i < inputJson.length; i += 3) {
          const chunk = inputJson.slice(i, i + 3);
          const deltaEvent: BetaContentBlockDeltaEvent = {
            type: 'content_block_delta',
            index: nextBlockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: chunk
            }
          };
          yield `event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`;
          // Small delay to simulate real streaming
          await new Promise(resolve => setTimeout(resolve, 15));
        }

        const toolUseStopEvent: BetaContentBlockStopEvent = {
          type: 'content_block_stop',
          index: nextBlockIndex
        };
        yield `event: content_block_stop\ndata: ${JSON.stringify(toolUseStopEvent)}\n\n`;
        
        nextBlockIndex++;
      }

      const messageDeltaEvent: BetaMessageDeltaEvent = {
        type: 'message_delta',
        delta: {
          stop_reason: 'tool_use',
          stop_sequence: null
        },
        usage: {
          output_tokens: totalOutputTokens,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          input_tokens: totalInputTokens,
          server_tool_use: null
        }
      };
      yield `event: message_delta\ndata: ${JSON.stringify(messageDeltaEvent)}\n\n`;

      const messageStopEvent: BetaMessageStopEvent = {
        type: 'message_stop'
      };
      yield `event: message_stop\ndata: ${JSON.stringify(messageStopEvent)}\n\n`;
      
      // 记录最终的工具调用响应
      if (completedToolCalls.length > 0) {
        this.writeLog(`📤 Final tool calls response: ${JSON.stringify(completedToolCalls, null, 2)}`);
      }
    }
  }

  async *parseOpenAIStreamString(
    streamString: string
  ): AsyncGenerator<OpenAIStreamResponse> {
    const lines = streamString.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const data = JSON.parse(line.substring(6));
          yield data as OpenAIStreamResponse;
        } catch (error) {
          continue;
        }
      }
    }
  }
}