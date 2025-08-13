import { BetaMessageCreateRequest } from '../types/claude';
import { ModelConfig } from '../config/models';
import { calculateTokenCount } from './token-calculator';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  const logDir = join(process.cwd(), 'logs');
  const logPath = join(logDir, 'routing.log');
  
  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    appendFileSync(logPath, logEntry);
  } catch (error) {
    console.error('Failed to write to routing log file:', error);
  }
}

export interface RouterConfig {
  default: string;
  longContext?: string;
  longContextThreshold?: number;
  webSearch?: string;
  background?: string;
  think?: string;
}

export const routeModel = async (
  request: BetaMessageCreateRequest,
  defaultModelConfig: ModelConfig,
  routerConfig: RouterConfig
): Promise<string> => {
  try {
    writeLog(`🔄 Starting model routing for request with model: ${request.model}`);
    
    // Calculate token count
    const tokenCount = calculateTokenCount(
      request.messages,
      request.system,
      request.tools || []
    );
    
    writeLog(`📊 Token count: ${tokenCount}`);

    // Check for web_search tools with strict conditions
    // Only route to web search model if:
    // 1. tools array has exactly one element
    // 2. that element is web_search_20250305 type with name 'web_search'
    // 3. system message contains the specific web search assistant indicator
    const hasExactlyOneWebSearchTool = request.tools && 
      request.tools.length === 1 &&
      request.tools[0].type === 'web_search_20250305' && 
      request.tools[0].name === 'web_search';

    let hasWebSearchSystemIndicator = false;
    if (request.system) {
      let systemText = '';
      if (Array.isArray(request.system)) {
        systemText = request.system.map(s => typeof s === 'string' ? s : (s as any).text || '').join(' ');
      } else if (typeof request.system === 'string') {
        systemText = request.system;
      } else {
        systemText = (request.system as any).text || '';
      }
      hasWebSearchSystemIndicator = systemText.includes('You are an assistant for performing a web search tool use');
    }

    if (hasExactlyOneWebSearchTool && hasWebSearchSystemIndicator && routerConfig.webSearch) {
      writeLog(`🌐 Using web search model: ${routerConfig.webSearch}`);
      return routerConfig.webSearch;
    }

    // Check for long context threshold
    const longContextThreshold = routerConfig.longContextThreshold || 60000;
    if (tokenCount > longContextThreshold && routerConfig.longContext) {
      writeLog(`📚 Using long context model due to token count: ${tokenCount} > ${longContextThreshold}`);
      return routerConfig.longContext;
    }

    // Check for haiku model (use background model)
    if (
      request.model?.includes('haiku') &&
      routerConfig.background
    ) {
      writeLog(`🏃 Using background model for haiku: ${routerConfig.background}`);
      return routerConfig.background;
    }

    // Check for thinking mode
    if ((request as any).thinking && routerConfig.think) {
      writeLog(`🤔 Using think model for thinking mode: ${routerConfig.think}`);
      return routerConfig.think;
    }

    writeLog(`✅ Using default model: ${routerConfig.default}`);
    return routerConfig.default;

  } catch (error: any) {
    writeLog(`❌ Error in router: ${error.message}`);
    console.error('Error in router middleware:', error.message);
    return routerConfig.default;
  }
};