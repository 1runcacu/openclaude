import { Router, Request, Response } from 'express';
import { BetaMessageCreateRequest } from '../types/claude';
import { ModelManager } from '../config/models';
import { ClaudeAdapter } from '../adapters/claude-adapter';
import { routeModel } from '../utils/router';
import { calculateTokenCount } from '../utils/token-calculator';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface MessagesRouterOptions {
  modelManager: ModelManager;
  claudeAdapter: ClaudeAdapter;
}

export function writeLog(message: string): void {
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

export function createMessagesRouter(options: MessagesRouterOptions): Router {
  const router = Router();
  const { modelManager, claudeAdapter } = options;

  router.post('/', async (req: Request, res: Response) => {
    try {
      const claudeRequest: BetaMessageCreateRequest = req.body;

      writeLog(`📨 Incoming Claude request: ${req.url}`);
      writeLog(`  Model: ${claudeRequest.model}`);

      // Calculate token count for logging
      const tokenCount = calculateTokenCount(
        claudeRequest.messages || [],
        claudeRequest.system,
        claudeRequest.tools || []
      );
      writeLog(`  Token count: ${tokenCount}`);
      writeLog(`  Full request body: ${JSON.stringify(claudeRequest, null, 2)}`);

      if (!claudeRequest.model || !claudeRequest.messages || !claudeRequest.max_tokens) {
        writeLog('❌ Missing required fields');
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Missing required fields: model, messages, and max_tokens are required'
          }
        });
      }

      if (!Array.isArray(claudeRequest.messages) || claudeRequest.messages.length === 0) {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Messages must be a non-empty array'
          }
        });
      }

      // Apply routing logic
      const routerConfig = modelManager.getRouterConfig();
      let finalModel = claudeRequest.model;
      
      if (routerConfig) {
        try {
          finalModel = await routeModel(claudeRequest, modelManager.getModelConfig(claudeRequest.model)!, routerConfig);
          if (finalModel !== claudeRequest.model) {
            writeLog(`🔄 Model routed from ${claudeRequest.model} to ${finalModel}`);
            claudeRequest.model = finalModel;
          }
        } catch (routerError) {
          writeLog(`⚠️  Router error: ${routerError}`);
        }
      }

      const modelConfig = modelManager.getModelConfig(finalModel);
      if (!modelConfig) {
        writeLog(`❌ Model not found: ${finalModel}`);
        writeLog(`Available models: ${modelManager.getAllModels().map(m => m.claudeModelName)}`);
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `Model ${finalModel} is not supported. Available models: ${modelManager.getAllModels().map(m => m.claudeModelName).join(', ')}`
          }
        });
      }
      writeLog(`✅ OpenAI model: ${modelConfig.openaiModelName}`);

      // 限制max_tokens到安全范围 - 考虑OpenAI API代理的限制
      const safeMaxTokens = modelConfig.maxTokens;
      
      if (claudeRequest.max_tokens > safeMaxTokens) {
        writeLog(`⚠️  Clamping max_tokens from ${claudeRequest.max_tokens} to ${safeMaxTokens} (model_limit: ${modelConfig.maxTokens})`);
        claudeRequest.max_tokens = safeMaxTokens;
      }

      if (claudeRequest.stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version, anthropic-beta');

        writeLog('🌊 Starting streaming response');
        
        let chunkCount = 0;
        let totalCharsWritten = 0;
        // let chuckInfo = ``;
        
        try {
          for await (const chunk of claudeAdapter.streamMessage(claudeRequest, modelConfig)) {
            res.write(chunk);
            chunkCount++;
            // chuckInfo += chunk;
            totalCharsWritten += chunk.length;
            
            // Log every 10 chunks to avoid spam
            // if (chunkCount % 10 === 0) {
            //   writeLog(`  Streaming progress: ${chunkCount} chunks, ${totalCharsWritten} chars`);
            // }
          }
          
          writeLog('✅ Streaming completed successfully');
          writeLog(`  Total chunks: ${chunkCount}`);
          writeLog(`  Total chars: ${totalCharsWritten}`);
          // writeLog(chuckInfo);
          res.end();
        } catch (error) {
          writeLog(`Streaming error: ${error}`);
          const errorResponse = {
            type: 'error',
            error: {
              type: 'api_error',
              message: error instanceof Error ? error.message : 'Stream processing error'
            }
          };
          res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
          res.end();
        }
      } else {
        const response = await claudeAdapter.createMessage(claudeRequest, modelConfig);
        writeLog(`Full response: ${JSON.stringify(response, null, 2)}`);
        writeLog('✅ Response sent successfully');
        res.json(response);
      }
    } catch (error) {
      writeLog(`Messages API error: ${error}`);
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Internal server error'
        }
      });
    }
  });

  // Add token counting endpoint
  router.post('/count_tokens', async (req: Request, res: Response) => {
    try {
      const request: any = req.body;
      if (!request.model || !request.messages) {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Missing required fields: model and messages are required'
          }
        });
      }
      const modelConfig = modelManager.getModelConfig(request.model);
      if (!modelConfig) {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `Model ${request.model} is not supported`
          }
        });
      }

      const tokenCount = await claudeAdapter.countTokens(request, modelConfig);
      res.json(tokenCount);
    } catch (error) {
      writeLog(`Token counting API error: ${error}`);
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Internal server error'
        }
      });
    }
  });

  return router;
}