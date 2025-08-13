import { writeLog } from "../routes/messages";
import { BetaMessageCreateRequest } from "../types/claude";

export interface WebSearchContext {
  hasWebSearch: boolean;
  searchQuery?: string;
  conversationHistory: Array<{ role: string; content: string }>;
  isToolResult?: boolean;
  toolResultContent?: string;
}

export function parseSearchResult(text: string) {
  // 找到最后一个]的位置
  const lastBracketIndex = text.lastIndexOf("]");
  if (lastBracketIndex === -1) return null;

  // 从最后一个]往前找到匹配的第一个[
  let bracketCount = 0;
  let firstBracketIndex = -1;

  for (let i = lastBracketIndex; i >= 0; i--) {
    if (text[i] === "]") {
      bracketCount++;
    } else if (text[i] === "[") {
      bracketCount--;
      if (bracketCount === 0) {
        firstBracketIndex = i;
        break;
      }
    }
  }
  if (firstBracketIndex === -1) return null;
  const queryPart = text.substring(0, firstBracketIndex).trim();
  const arrayPart = text.substring(firstBracketIndex, lastBracketIndex + 1);
  const linksArray = JSON.parse(arrayPart) as Array<{
    title: string;
    url: string;
  }>;
  return {
    queryPart,
    linksArray,
  };
}

export class WebSearchHandler {
  constructor() {}

  /**
   * Detect if a request should trigger web search functionality
   */
  detectWebSearchRequest(request: BetaMessageCreateRequest): WebSearchContext {
    const context: WebSearchContext = {
      hasWebSearch: false,
      conversationHistory: [],
      isToolResult: false,
    };

    // Check if tools array has exactly one web search tool
    const hasExactlyOneWebSearchTool =
      request.tools &&
      request.tools.length === 1 &&
      request.tools[0].type === "web_search_20250305" &&
      request.tools[0].name === "web_search";

    // Simplified web search detection - only check for the exact tool configuration

    // Check if this is a tool result request for WebSearch
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((msg) => msg.role === "user");
    let isWebSearchToolResult = false;
    let toolResultContent = "";

    if (lastUserMessage && Array.isArray(lastUserMessage.content)) {
      for (const contentBlock of lastUserMessage.content) {
        if (
          contentBlock.type === "tool_result" &&
          typeof contentBlock.content === "string" &&
          contentBlock.content.includes("Web search results for query:")
        ) {
          isWebSearchToolResult = true;
          toolResultContent = contentBlock.content;

          // Extract search query from tool result content
          context.searchQuery = parseSearchResult(
            contentBlock.content
          )?.queryPart;
          writeLog(
            "🔍 [WebSearchHandler] Detected tool result with query:" +
              context.searchQuery
          );
          break;
        }
      }
    }

    if (hasExactlyOneWebSearchTool) {
      context.hasWebSearch = true;
      context.isToolResult = isWebSearchToolResult;

      // Extract conversation history
      for (const msg of request.messages) {
        const content = Array.isArray(msg.content)
          ? msg.content.map((c) => (c.type === "text" ? c.text : "")).join(" ")
          : typeof msg.content === "string"
          ? msg.content
          : "";

        if (content.trim()) {
          context.conversationHistory.push({
            role: msg.role,
            content: content.trim(),
          });
        }
      }

      // Extract search query from the last user message (for initial requests)
      if (!isWebSearchToolResult && lastUserMessage) {
        const userContent = Array.isArray(lastUserMessage.content)
          ? lastUserMessage.content
              .map((c) => (c.type === "text" ? c.text : ""))
              .join(" ")
          : typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : "";

        // Extract query from patterns like "Perform a web search for the query: ..."
        const searchMatch = userContent.match(
          /(?:web search for (?:the )?query:?\s*|search for:?\s*)(.+?)(?:\.|$)/i
        );
        if (searchMatch) {
          context.searchQuery = searchMatch[1].trim();
        } else {
          // Fallback to using the entire user message as query
          context.searchQuery = userContent.trim();
        }
      }
    } else if (isWebSearchToolResult) {
      // Handle tool result even without the exact tool configuration
      context.hasWebSearch = true;
      context.isToolResult = true;
      context.toolResultContent = toolResultContent;
    }

    return context;
  }

  /**
   * Create web search tool result content block - matches real Claude API format
   */
  createWebSearchToolResultBlock(searchData: any) {
    if (!searchData || !searchData.searchPerformed) {
      return null;
    }

    return {
      type: "web_search_tool_result",
      tool_use_id:
        searchData.toolUseId ||
        `srvtoolu_${Math.random().toString(36).substring(2, 15)}`,
      content:
        searchData.results.map((result: any) => ({
          type: "web_search_result",
          title: result.title,
          url: result.url,
          encrypted_content:
            result.encrypted_content ||
            `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`,
          page_age: result.page_age || "June 19, 2025",
        })) || [],
    };
  }
}
