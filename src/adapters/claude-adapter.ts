import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessageCreateRequest,
  BetaMessage,
  BetaMessageTokensCount,
} from "../types/claude";
import { ModelConfig } from "../config/models";
import { RequestConverter } from "./request-converter";
import { ResponseConverter } from "./response-converter";
import {
  parseSearchResult,
  WebSearchHandler,
} from "../utils/web-search-handler";
import { memoryStore } from "../utils/memory-store";
import { writeLog } from "../routes/messages";

// Alibaba Web Search Types
interface AlibabaHistoryMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AlibabaWebSearchRequest {
  history: AlibabaHistoryMessage[];
  query: string;
  query_rewrite: boolean;
  top_k: number;
  content_type: "snippet";
}

interface AlibabaSearchResult {
  link: string;
  title: string;
  content: string;
  snippet: string;
  position: number | null;
}

interface AlibabaUsage {
  "rewrite_model.output_tokens": number;
  "rewrite_model.total_tokens": number;
  "rewrite_model.input_tokens": number;
  search_count: number;
}

interface AlibabaWebSearchResponse {
  request_id: string;
  latency: number;
  usage: AlibabaUsage;
  result: {
    search_result: AlibabaSearchResult[];
  };
}
export class ClaudeAdapter {
  private requestConverter: RequestConverter;
  private responseConverter: ResponseConverter;
  private webSearchHandler: WebSearchHandler;

  constructor(private openaiClient: OpenAI) {
    this.requestConverter = new RequestConverter();
    this.responseConverter = new ResponseConverter();
    this.webSearchHandler = new WebSearchHandler();
  }

  async createMessage(
    claudeRequest: BetaMessageCreateRequest,
    modelConfig: ModelConfig
  ): Promise<BetaMessage> {
    // Check for web search request
    const webSearchContext =
      this.webSearchHandler.detectWebSearchRequest(claudeRequest);

    if (webSearchContext.hasWebSearch) {
      // If this is a tool result request, provide a response based on the search results
      if (webSearchContext.isToolResult) {
        writeLog("📋 [ADAPTER] Processing web search tool result");

        // For tool result cases, we should have the search results from the previous request
        // Extract the previous search results from the request context
        writeLog(
          "🔎 [ADAPTER] Searching through " +
            claudeRequest.messages.length +
            " messages..."
        );
        const toolResultMessage = [...claudeRequest.messages]
          .reverse()
          .find(
            (msg) =>
              Array.isArray(msg.content) &&
              msg.content.some((block) => block.type === "tool_result")
          );

        if (toolResultMessage) {
          const toolResultBlock = [...(toolResultMessage.content as any[])]
            .reverse()
            .find((block) => block.type === "tool_result");

          if (toolResultBlock && toolResultBlock.content) {
            let searchResults = toolResultBlock.content;
            const searchQuery = webSearchContext.searchQuery ?? "";

            // Handle different content formats
            if (typeof searchResults === "string") {
              // If content is a string, try to parse it or create a dummy array
              try {
                searchResults = parseSearchResult(searchResults)?.linksArray;
              } catch (e) {
                writeLog(
                  "⚠️ [ADAPTER] Content is string, creating dummy result array"
                );
                searchResults = [];
              }
            }
            // Generate formatted response using LLM
            const formattedResponse = await this.generateFormattedResponse(
              searchQuery,
              searchResults,
              modelConfig
            );

            const toolUseId = `srvtoolu_${Math.random()
              .toString(36)
              .substring(2, 15)}`;

            const webSearchResult = {
              searchPerformed: true,
              query: searchQuery,
              toolUseId: toolUseId,
              results: searchResults,
              formattedResponse: formattedResponse,
              usage: {
                web_search_requests: 1,
              },
            };

            // Return response with both web search tool result and text
            const content: any[] = [];

            // Add web search tool result block
            const webSearchToolResultBlock =
              this.webSearchHandler.createWebSearchToolResultBlock(
                webSearchResult
              );
            if (webSearchToolResultBlock) {
              content.push(webSearchToolResultBlock);
            }
            // Add text content
            content.push({
              type: "text",
              text: formattedResponse,
              citations: null,
            });

            const toolResultResponse: BetaMessage = {
              id: `msg_${Math.random()
                .toString(36)
                .substring(2, 15)}${Math.random()
                .toString(36)
                .substring(2, 15)}`,
              type: "message",
              role: "assistant",
              model: claudeRequest.model,
              content: content,
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: {
                input_tokens: this.estimateTokens(
                  JSON.stringify(claudeRequest)
                ),
                output_tokens: this.estimateTokens(formattedResponse),
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                server_tool_use: {
                  web_search_requests: 1,
                },
                service_tier: null,
              },
            };

            return toolResultResponse;
          }
        }

        // Fallback if no tool results found
        throw new Error("No search results found in tool result request");
      }

      // Initial web search request - call Aliyun API
      const searchQuery = webSearchContext.searchQuery || "";

      try {
        const aliyunResult = await this.callAliyunSearch(
          searchQuery,
          claudeRequest
        );

        if (!aliyunResult || !aliyunResult.result?.search_result) {
          throw new Error("No search results from Aliyun API");
        }

        // Convert Aliyun format to Claude format
        const serverToolUseId = `srvtoolu_${Math.random()
          .toString(36)
          .substring(2, 15)}`;

        const claudeResponse: BetaMessage = {
          id: `msg_${Math.random().toString(36).substring(2, 15)}${Math.random()
            .toString(36)
            .substring(2, 15)}`,
          type: "message",
          role: "assistant",
          model: claudeRequest.model,
          content: [
            {
              type: "text",
              text: `I'll search for information about ${searchQuery}.`,
              citations: null,
            },
            {
              type: "server_tool_use",
              id: serverToolUseId,
              name: "web_search",
              input: {
                query: searchQuery,
              },
            },
            {
              type: "web_search_tool_result",
              tool_use_id: serverToolUseId,
              content:
                aliyunResult.result.search_result.map((result: any) => ({
                  type: "web_search_result",
                  title: result.title,
                  url: result.link,
                  encrypted_content: Buffer.from(
                    result.content || result.snippet || ""
                  ).toString("base64"),
                  page_age: new Date().toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  }),
                })) || [],
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: this.estimateTokens(JSON.stringify(claudeRequest)),
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: this.estimateTokens(
              `I'll search for information about ${searchQuery}.`
            ),
            service_tier: "standard",
            server_tool_use: {
              web_search_requests: aliyunResult.usage?.search_count || 1,
            },
          },
        };

        return claudeResponse;
      } catch (error: any) {
        console.error("❌ [ALIYUN] Fallback also failed:", error.message);
        throw new Error("Both API call and fallback failed");
      }
    }

    const openAIRequest = this.requestConverter.convertClaudeToOpenAI(
      claudeRequest,
      modelConfig
    );

    try {
      writeLog("📡 [ADAPTER] Calling OpenAI API...");
      writeLog("📄 [ADAPTER] OpenAI model:" + modelConfig.openaiModelName);
      const openAIResponse = await this.openaiClient.chat.completions.create({
        ...openAIRequest,
        stream: false,
      } as any);

      writeLog("✅ [ADAPTER] OpenAI API response received");
      writeLog(
        "📥 Response preview:" +
          JSON.stringify({
            id: (openAIResponse as any).id,
            model: (openAIResponse as any).model,
            usage: (openAIResponse as any).usage,
            choices_count: (openAIResponse as any).choices?.length,
          })
      );

      const claudeResponse = this.responseConverter.convertOpenAIToClaude(
        openAIResponse as any,
        claudeRequest.model
      );

      return claudeResponse;
    } catch (error: any) {
      writeLog("  Message:" + error.message);
      throw new Error(
        `OpenAI API error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async *streamMessage(
    claudeRequest: BetaMessageCreateRequest,
    modelConfig: ModelConfig
  ): AsyncGenerator<string> {
    // Check for web search request
    const webSearchContext =
      this.webSearchHandler.detectWebSearchRequest(claudeRequest);

    if (webSearchContext.hasWebSearch) {
      writeLog("🔍 [STREAM] Web search streaming request detected");
      writeLog(`⏰ [STREAM] Stream start time: ${new Date().toISOString()}`);

      const createMessageStartTime = Date.now();

      // Call the non-streaming version first to get the data
      const claudeResponse = await this.createMessage(
        claudeRequest,
        modelConfig
      );

      const createMessageEndTime = Date.now();
      writeLog(
        `✅ [STREAM] createMessage completed in ${
          createMessageEndTime - createMessageStartTime
        } ms`
      );
      // Convert to streaming format
      yield* this.responseConverter.convertClaudeToStream(claudeResponse);
      return;
    }

    // Fallback to normal OpenAI streaming
    const openAIRequest = this.requestConverter.convertClaudeToOpenAI(
      claudeRequest,
      modelConfig
    );

    try {
      const openAIStream = await this.openaiClient.chat.completions.create({
        ...openAIRequest,
        stream: true,
      } as any);

      yield* this.responseConverter.convertOpenAIStreamToClaude(
        openAIStream as any,
        claudeRequest.model
      );
    } catch (error) {
      writeLog(`OpenAI streaming error: ${JSON.stringify(error)}`);

      const errorResponse = {
        type: "error",
        error: {
          type: "api_error",
          message:
            error instanceof Error ? error.message : "Unknown streaming error",
        },
      };

      yield `data: ${JSON.stringify(errorResponse)}\n\n`;
    }
  }

  async countTokens(
    request: Anthropic.MessageCountTokensParams,
    _modelConfig: ModelConfig
  ): Promise<BetaMessageTokensCount> {
    // For token counting, we'll estimate based on the content
    // Since OpenAI doesn't have a direct token counting endpoint, we'll calculate
    let totalTokens = 0;

    // Estimate system message tokens
    if (request.system) {
      if (typeof request.system === "string") {
        totalTokens += this.estimateTokens(request.system);
      } else if (Array.isArray(request.system)) {
        for (const block of request.system) {
          if (block.type === "text") {
            totalTokens += this.estimateTokens(block.text);
          }
        }
      }
    }

    // Estimate messages tokens
    for (const message of request.messages) {
      if (typeof message.content === "string") {
        totalTokens += this.estimateTokens(message.content);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "text") {
            totalTokens += this.estimateTokens(block.text);
          }
          // Add estimation for other block types as needed
        }
      }
    }

    // Estimate tools tokens
    if (request.tools) {
      for (const tool of request.tools) {
        totalTokens += this.estimateTokens(JSON.stringify(tool));
      }
    }

    return {
      input_tokens: totalTokens,
    };
  }

  private estimateTokens(text: string): number {
    // Simple estimation: roughly 1 token per 4 characters
    // This is a rough approximation - in production you'd want a proper tokenizer
    return Math.ceil(text.length / 4);
  }

  /**
   * Call Aliyun web search API
   */
  private async callAliyunSearch(
    query: string,
    claudeRequest: BetaMessageCreateRequest
  ): Promise<AlibabaWebSearchResponse | null> {
    const requestBody = {
      history: [
        // @ts-ignore
        ...(claudeRequest?.system ?? [])!.map((v: any) => ({
          role: "system",
          content: v.type === "text" ? v.text : JSON.stringify(v),
        })),
        ...claudeRequest.messages.map((msg) => ({
          role: msg.role,
          content: Array.isArray(msg.content)
            ? msg.content
                .map((block) =>
                  block.type === "text" ? block.text : JSON.stringify(block)
                )
                .join("\n")
            : msg.content,
        })),
      ],
      query: query,
      query_rewrite: true,
      top_k: 10,
      content_type: "snippet",
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      writeLog("⏰ [ALIYUN] Request timeout after 60 seconds");
      controller.abort();
    }, 60000); // 60 second timeout
    try {
      // 摆烂直接走aliyun的websearch接口
      /**
       * 文档链接
       * https://help.aliyun.com/zh/open-search/search-platform/developer-reference/web-search
       */
      const searchApiUrl = process.env.WEB_SEARCH_BASE_URL!;
      const searchApiKey = process.env.WEB_SEARCH_API_KEY;

      const response = await fetch(searchApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${searchApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        writeLog(`❌ [ALIYUN] Error response body: ${errorText}`);
        throw new Error(
          `HTTP error! status: ${response.status}, body: ${errorText}`
        );
      }

      const result = (await response.json()) as AlibabaWebSearchResponse;

      writeLog("📋 [ALIYUN] Result preview:" + JSON.stringify(result, null, 2));

      result.result.search_result.forEach((i) => {
        memoryStore.set(i.link, { ...i });
      });
      return result;
    } catch (error: any) {
      clearTimeout(timeoutId);
      writeLog("📝 [ALIYUN] Error message:" + error?.message);
      if (error?.name === "AbortError") {
        writeLog("⏰ [ALIYUN] Request was aborted due to timeout");
      }
      return null;
    }
  }

  /**
   * Generate formatted response using LLM based on search results
   */
  private async generateFormattedResponse(
    query: string,
    searchResults: any[],
    modelConfig: ModelConfig
  ): Promise<string> {
    if (!searchResults || searchResults.length === 0) {
      writeLog("⚠️ [LLM] No search results found");
      return `I searched for "${query}" but couldn't find any relevant results.`;
    }

    try {
      // Extract key information from search results
      const resultSummaries = searchResults
        .map((result, index) => {
          const info = memoryStore.get(
            result.url
          ) as AlibabaSearchResult | null;
          const content = info?.content || "No content available";
          return `${index + 1}. **${info?.title ?? result.title}**\n   URL: ${
            result.url
          }\n   Content: ${
            content.substring(0, 300) + (content.length > 300 ? "..." : "")
          }`;
        })
        .join("\n\n");

      // Create a prompt for the LLM to generate a formatted response
      const prompt = `Based on the following search results for "${query}", please provide a comprehensive and well-structured response:\n\n${resultSummaries}\n\nPlease analyze and synthesize the information to provide a helpful answer to the query.`;

      try {
        const openAIResponse = await this.openaiClient.chat.completions.create({
          model: modelConfig.openaiModelName,
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that analyzes search results and provides comprehensive, well-structured responses.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        });

        const formattedResponse =
          openAIResponse.choices[0]?.message?.content ||
          this.generateFallbackResponse(query, searchResults);

        return formattedResponse;
      } catch (llmError) {
        writeLog("❌ [LLM] LLM formatting error:" + JSON.stringify(llmError));
        return this.generateFallbackResponse(query, searchResults);
      }
    } catch (error) {
      writeLog(
        "❌ [LLM] Error generating formatted response:" + JSON.stringify(error)
      );
      return `I found search results for "${query}" but encountered an error while formatting the response.`;
    }
  }

  /**
   * Generate a fallback response when LLM formatting fails
   */
  private generateFallbackResponse(
    query: string,
    searchResults: any[]
  ): string {
    const resultSummaries = searchResults
      .map((result, index) => {
        return `${index + 1}. **${result.title}**\n   URL: ${
          result.url
        }\n   Content: ${
          result.content
            ? result.content.substring(0, 200) + "..."
            : "No content available"
        }`;
      })
      .join("\n\n");

    return `Based on the search results for "${query}", here's what I found:\n\n${resultSummaries}\n\n**Summary:**\n${this.generateSummaryFromResults(
      searchResults
    )}`;
  }

  /**
   * Generate a summary from search results
   */
  private generateSummaryFromResults(searchResults: any[]): string {
    // Simple extraction logic - in practice you'd want to use NLP/LLM here
    const titles = searchResults.map((r) => r.title).join(", ");
    const domains = [
      ...new Set(
        searchResults.map((r) => {
          try {
            return new URL(r.url).hostname;
          } catch {
            return "unknown";
          }
        })
      ),
    ].join(", ");

    return `Found ${searchResults.length} relevant sources from ${domains}. The search covered topics related to: ${titles}.`;
  }
}
