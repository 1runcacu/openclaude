// Re-export official types from @anthropic-ai/sdk
import type Anthropic from '@anthropic-ai/sdk';

// Main message types
export type BetaMessage = Anthropic.Messages.Message;
export type BetaMessageParam = Anthropic.MessageParam;
export type BetaMessageCreateRequest = Anthropic.MessageCreateParams;
export type BetaMessageTokensCount = Anthropic.Messages.MessageTokensCount;

// Content block types
export type BetaContentBlock = Anthropic.ContentBlock;
export type BetaContentBlockParam = Anthropic.ContentBlockParam;
export type BetaTextBlock = Anthropic.TextBlock;
export type BetaTextBlockParam = Anthropic.TextBlockParam;
export type BetaImageBlockParam = Anthropic.ImageBlockParam;
export type BetaToolUseBlock = Anthropic.ToolUseBlock;
export type BetaToolUseBlockParam = Anthropic.ToolUseBlockParam;
export type BetaToolResultBlockParam = Anthropic.ToolResultBlockParam;

// Tool types
export type BetaTool = Anthropic.Tool;
export type BetaToolChoice = Anthropic.ToolChoice;

// Stream event types
export type BetaStreamEvent = Anthropic.MessageStreamEvent;
export type BetaMessageStartEvent = Anthropic.MessageStartEvent;
export type BetaContentBlockStartEvent = Anthropic.ContentBlockStartEvent;
export type BetaContentBlockDeltaEvent = Anthropic.ContentBlockDeltaEvent;
export type BetaContentBlockStopEvent = Anthropic.ContentBlockStopEvent;
export type BetaMessageDeltaEvent = Anthropic.MessageDeltaEvent;
export type BetaMessageStopEvent = Anthropic.MessageStopEvent;

// Usage and other types
export type BetaUsage = Anthropic.Usage;
export type BetaStopReason = Anthropic.StopReason;
export type BetaModel = Anthropic.Model;

// Base64 source types
export type BetaBase64ImageSource = Anthropic.Base64ImageSource;
export type BetaBase64PDFSource = Anthropic.Base64PDFSource;
export type BetaURLImageSource = Anthropic.URLImageSource;
export type BetaURLPDFSource = Anthropic.URLPDFSource;

// Document and search result types
export type BetaDocumentBlockParam = Anthropic.DocumentBlockParam;
export type BetaSearchResultBlockParam = Anthropic.SearchResultBlockParam;

// Thinking block types (when available)
export type BetaThinkingBlock = Anthropic.ThinkingBlock;
export type BetaThinkingBlockParam = Anthropic.ThinkingBlockParam;
export type BetaThinkingConfigParam = Anthropic.ThinkingConfigParam;

// Web search types
export type BetaWebSearchTool20250305 = Anthropic.WebSearchTool20250305;
export type BetaWebSearchResultBlockParam = Anthropic.WebSearchResultBlockParam;

// Citation types
export type BetaTextCitation = Anthropic.TextCitation;
export type BetaTextCitationParam = Anthropic.TextCitationParam;
export type BetaCitationsConfigParam = Anthropic.CitationsConfigParam;

// Cache control
export type BetaCacheControlEphemeral = Anthropic.CacheControlEphemeral;

// Metadata
export type BetaMetadata = Anthropic.Metadata;