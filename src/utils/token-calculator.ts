import { get_encoding } from "tiktoken";
import { BetaMessageParam } from '../types/claude';
import type Anthropic from '@anthropic-ai/sdk';

const enc = get_encoding("cl100k_base");

export const calculateTokenCount = (
  messages: BetaMessageParam[],
  system: any,
  tools: Anthropic.ToolUnion[]
): number => {
  let tokenCount = 0;

  // Count tokens in messages
  if (Array.isArray(messages)) {
    messages.forEach((message) => {
      if (typeof message.content === "string") {
        tokenCount += enc.encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        message.content.forEach((contentPart: any) => {
          if (contentPart.type === "text") {
            tokenCount += enc.encode(contentPart.text).length;
          } else if (contentPart.type === "tool_use") {
            tokenCount += enc.encode(JSON.stringify(contentPart.input)).length;
          } else if (contentPart.type === "tool_result") {
            tokenCount += enc.encode(
              typeof contentPart.content === "string"
                ? contentPart.content
                : JSON.stringify(contentPart.content)
            ).length;
          }
        });
      }
    });
  }

  // Count tokens in system message
  if (typeof system === "string") {
    tokenCount += enc.encode(system).length;
  } else if (Array.isArray(system)) {
    system.forEach((item: any) => {
      if (item.type !== "text") return;
      if (typeof item.text === "string") {
        tokenCount += enc.encode(item.text).length;
      } else if (Array.isArray(item.text)) {
        item.text.forEach((textPart: any) => {
          tokenCount += enc.encode(textPart || "").length;
        });
      }
    });
  }

  // Count tokens in tools
  if (tools && Array.isArray(tools)) {
    tools.forEach((tool: Anthropic.ToolUnion) => {
      const description = 'description' in tool ? tool.description : '';
      tokenCount += enc.encode(tool.name + (description || '')).length;
      
      if ('input_schema' in tool && tool.input_schema) {
        tokenCount += enc.encode(JSON.stringify(tool.input_schema)).length;
      }
    });
  }

  return tokenCount;
};