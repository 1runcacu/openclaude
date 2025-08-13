import { BetaMessageCreateRequest, BetaMessageParam, BetaContentBlockParam } from '../types/claude';
import { OpenAIChatCompletionRequest, OpenAIMessage, OpenAIMessageContentPart, OpenAITool } from '../types/openai';
import { ModelConfig } from '../config/models';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function writeLog(message: string): void {
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

export class RequestConverter {
  convertClaudeToOpenAI(claudeRequest: BetaMessageCreateRequest, modelConfig: ModelConfig): OpenAIChatCompletionRequest {
    const openAIMessages: OpenAIMessage[] = [];

    if (claudeRequest.system) {
      openAIMessages.push({
        role: 'system',
        content: claudeRequest.system
      });
    }

    claudeRequest.messages.forEach((message, index) => {
      openAIMessages.push(this.convertMessage(message));
    });

    // Double protection: ensure max_tokens is within both Claude and OpenAI API limits
    // Many OpenAI API proxies limit max_tokens to 8192 even if the model supports more
    const absoluteMaxTokens = 8192; // Conservative limit for OpenAI API compatibility
    const finalMaxTokens = Math.min(
      claudeRequest.max_tokens, 
      modelConfig.maxTokens, 
      absoluteMaxTokens
    );
    
    writeLog(`  Final max_tokens: ${finalMaxTokens} (requested: ${claudeRequest.max_tokens}, model_limit: ${modelConfig.maxTokens}, api_limit: ${absoluteMaxTokens})`);

    const openAIRequest: OpenAIChatCompletionRequest = {
      model: modelConfig.openaiModelName,
      messages: openAIMessages,
      max_tokens: finalMaxTokens,
      stream: claudeRequest.stream || false
    };

    if (claudeRequest.temperature !== undefined) {
      openAIRequest.temperature = claudeRequest.temperature;
    }

    if (claudeRequest.top_p !== undefined) {
      openAIRequest.top_p = claudeRequest.top_p;
    }

    if (claudeRequest.stop_sequences && claudeRequest.stop_sequences.length > 0) {
      openAIRequest.stop = claudeRequest.stop_sequences;
    }

    if (claudeRequest.tools && claudeRequest.tools.length > 0) {
      writeLog(`  Converting ${claudeRequest.tools.length} tools to OpenAI format`);
      const validTools = claudeRequest.tools
        .filter(tool => 'input_schema' in tool) // Filter out tools without input_schema
        .map(tool => this.convertTool(tool as any));
      
      if (validTools.length > 0) {
        openAIRequest.tools = validTools;
        openAIRequest.tool_choice = 'auto';
      } else {
        // If no valid tools, don't include tools in request
        writeLog(`  Warning: No valid tools found (all filtered out due to missing input_schema)`);
      }
    }

    return openAIRequest;
  }

  private convertMessage(claudeMessage: BetaMessageParam): OpenAIMessage {
    if (typeof claudeMessage.content === 'string') {
      return {
        role: claudeMessage.role === 'user' ? 'user' : 'assistant',
        content: claudeMessage.content
      };
    }

    // Handle complex content with tool use/results
    const toolUseBlocks = claudeMessage.content.filter(block => block.type === 'tool_use');
    const toolResultBlocks = claudeMessage.content.filter(block => block.type === 'tool_result');
    
    if (toolUseBlocks.length > 0) {
      // Assistant message with tool calls
      const textBlocks = claudeMessage.content.filter(block => block.type === 'text');
      const content = textBlocks.length > 0 ? textBlocks.map(b => b.text).join('\n') : '';
      
      return {
        role: 'assistant',
        content: content,
        tool_calls: toolUseBlocks.map(block => ({
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        }))
      };
    }

    if (toolResultBlocks.length > 0) {
      // Tool result messages (should be converted to individual tool messages)
      // For now, return the first tool result as content
      const toolResult = toolResultBlocks[0];
      return {
        role: 'tool',
        content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
        tool_call_id: toolResult.tool_use_id
      };
    }

    // Regular message
    return {
      role: claudeMessage.role === 'user' ? 'user' : 'assistant',
      content: this.convertContent(claudeMessage.content) as string | OpenAIMessageContentPart[]
    };
  }

  private convertContent(content: string | BetaContentBlockParam[]): string | OpenAIMessageContentPart[] {
    if (typeof content === 'string') {
      return content;
    }

    const openAIContent: OpenAIMessageContentPart[] = [];

    content.forEach(block => {
      if (block.type === 'text') {
        openAIContent.push({
          type: 'text',
          text: block.text
        });
      } else if (block.type === 'image') {
        // Handle both base64 and URL sources
        let imageUrl: string;
        if ('source' in block) {
          if (block.source.type === 'base64') {
            imageUrl = `data:${block.source.media_type};base64,${block.source.data}`;
          } else if (block.source.type === 'url') {
            imageUrl = block.source.url;
          } else {
            // Handle other source types if needed
            imageUrl = '';
          }
        } else {
          imageUrl = '';
        }

        if (imageUrl) {
          openAIContent.push({
            type: 'image_url',
            image_url: {
              url: imageUrl,
              detail: 'auto'
            }
          });
        }
      } else if (block.type === 'document') {
        // Convert document to text content
        if ('source' in block) {
          const docText = block.source.type === 'base64' 
            ? `[Document: ${block.source.media_type}]`
            : `[Document content]`;
          openAIContent.push({
            type: 'text',
            text: docText
          });
        }
      } else if (block.type === 'thinking') {
        // Handle thinking blocks - convert to text for OpenAI
        openAIContent.push({
          type: 'text',
          text: `[Thinking: ${block.thinking}]`
        });
      }
      // Note: tool_use and tool_result blocks are handled differently
      // They need to be converted to OpenAI message format rather than content parts
    });

    return openAIContent;
  }

  private convertTool(claudeTool: any): OpenAITool {
    return {
      type: 'function',
      function: {
        name: claudeTool.name,
        description: claudeTool.description || '',
        parameters: claudeTool.input_schema || { type: 'object', properties: {} }
      }
    };
  }
}