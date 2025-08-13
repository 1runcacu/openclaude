import { Router, Request, Response } from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { ModelManager } from '../config/models';
import { ClaudeAdapter } from '../adapters/claude-adapter';
import { v4 as uuidv4 } from 'uuid';

interface BatchesRouterOptions {
  modelManager: ModelManager;
  claudeAdapter: ClaudeAdapter;
}

// Simple in-memory batch storage (in production, use a database)
interface BatchJob {
  id: string;
  object: 'message_batch';
  processing_status: 'validating' | 'in_progress' | 'canceling' | 'ended';
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
  };
  ended_at: string | null;
  archived_at: string | null;
  cancel_initiated_at: string | null;
  expires_at: string;
  created_at: string;
  requests: Array<{
    custom_id: string;
    method: 'POST';
    url: '/v1/messages';
    body: any;
  }>;
  results?: Array<{
    custom_id: string;
    result: {
      type: 'succeeded' | 'errored' | 'canceled';
      message?: any;
      error?: any;
    };
  }>;
}

const batches = new Map<string, BatchJob>();

export function createBatchesRouter(options: BatchesRouterOptions): Router {
  const router = Router();
  const { modelManager, claudeAdapter } = options;

  // Create batch
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { requests } = req.body;

      if (!requests || !Array.isArray(requests)) {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'requests field is required and must be an array'
          }
        });
      }

      const batchId = `batch_${uuidv4()}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

      const batch: BatchJob = {
        id: batchId,
        object: 'message_batch',
        processing_status: 'validating',
        request_counts: {
          processing: requests.length,
          succeeded: 0,
          errored: 0,
          canceled: 0
        },
        ended_at: null,
        archived_at: null,
        cancel_initiated_at: null,
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
        requests: requests
      };

      batches.set(batchId, batch);

      // Start processing asynchronously
      processBatchAsync(batch, modelManager, claudeAdapter);

      const response = {
        id: batch.id,
        object: batch.object,
        processing_status: batch.processing_status,
        request_counts: batch.request_counts,
        ended_at: batch.ended_at,
        archived_at: batch.archived_at,
        cancel_initiated_at: batch.cancel_initiated_at,
        expires_at: batch.expires_at,
        created_at: batch.created_at
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Internal server error'
        }
      });
    }
  });

  // Get batch
  router.get('/:batchId', (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const batch = batches.get(batchId);

      if (!batch) {
        return res.status(404).json({
          type: 'error',
          error: {
            type: 'not_found_error',
            message: `Batch ${batchId} not found`
          }
        });
      }

      const response = {
        id: batch.id,
        object: batch.object,
        processing_status: batch.processing_status,
        request_counts: batch.request_counts,
        ended_at: batch.ended_at,
        archived_at: batch.archived_at,
        cancel_initiated_at: batch.cancel_initiated_at,
        expires_at: batch.expires_at,
        created_at: batch.created_at
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Internal server error'
        }
      });
    }
  });

  // List batches
  router.get('/', (req: Request, res: Response) => {
    try {
      const batchList = Array.from(batches.values()).map(batch => ({
        id: batch.id,
        object: batch.object,
        processing_status: batch.processing_status,
        request_counts: batch.request_counts,
        ended_at: batch.ended_at,
        archived_at: batch.archived_at,
        cancel_initiated_at: batch.cancel_initiated_at,
        expires_at: batch.expires_at,
        created_at: batch.created_at
      }));

      res.json({
        object: 'list',
        data: batchList,
        has_more: false
      });
    } catch (error) {
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Internal server error'
        }
      });
    }
  });

  // Cancel batch
  router.post('/:batchId/cancel', (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const batch = batches.get(batchId);

      if (!batch) {
        return res.status(404).json({
          type: 'error',
          error: {
            type: 'not_found_error',
            message: `Batch ${batchId} not found`
          }
        });
      }

      if (batch.processing_status === 'ended') {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Cannot cancel a batch that has already ended'
          }
        });
      }

      batch.processing_status = 'canceling';
      batch.cancel_initiated_at = new Date().toISOString();

      const response = {
        id: batch.id,
        object: batch.object,
        processing_status: batch.processing_status,
        request_counts: batch.request_counts,
        ended_at: batch.ended_at,
        archived_at: batch.archived_at,
        cancel_initiated_at: batch.cancel_initiated_at,
        expires_at: batch.expires_at,
        created_at: batch.created_at
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Internal server error'
        }
      });
    }
  });

  // Get batch results
  router.get('/:batchId/results', (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const batch = batches.get(batchId);

      if (!batch) {
        return res.status(404).json({
          type: 'error',
          error: {
            type: 'not_found_error',
            message: `Batch ${batchId} not found`
          }
        });
      }

      if (!batch.results) {
        return res.status(400).json({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Batch results are not yet available'
          }
        });
      }

      // Return results as JSONL
      const jsonlResults = batch.results.map(result => JSON.stringify(result)).join('\n');
      res.setHeader('Content-Type', 'application/jsonl');
      res.send(jsonlResults);
    } catch (error) {
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

// Process batch asynchronously
async function processBatchAsync(
  batch: BatchJob,
  modelManager: ModelManager,
  claudeAdapter: ClaudeAdapter
) {
  try {
    batch.processing_status = 'in_progress';
    batch.results = [];

    for (const request of batch.requests) {
      if (batch.cancel_initiated_at) {
        batch.request_counts.canceled++;
        batch.request_counts.processing--;
        batch.results.push({
          custom_id: request.custom_id,
          result: {
            type: 'canceled'
          }
        });
        continue;
      }

      try {
        const modelConfig = modelManager.getModelConfig(request.body.model);
        if (!modelConfig) {
          throw new Error(`Model ${request.body.model} not supported`);
        }

        const response = await claudeAdapter.createMessage(request.body, modelConfig);
        
        batch.results.push({
          custom_id: request.custom_id,
          result: {
            type: 'succeeded',
            message: response
          }
        });
        
        batch.request_counts.succeeded++;
        batch.request_counts.processing--;
      } catch (error) {
        batch.results.push({
          custom_id: request.custom_id,
          result: {
            type: 'errored',
            error: {
              type: 'api_error',
              message: error instanceof Error ? error.message : 'Unknown error'
            }
          }
        });
        
        batch.request_counts.errored++;
        batch.request_counts.processing--;
      }
    }

    batch.processing_status = 'ended';
    batch.ended_at = new Date().toISOString();
  } catch (error) {
    batch.processing_status = 'ended';
    batch.ended_at = new Date().toISOString();
    console.error('Batch processing error:', error);
  }
}