import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { ModelManager } from "./config/models";
import { OpenAIClientManager } from "./config/openai";
import { ClaudeAdapter } from "./adapters/claude-adapter";
import { createMessagesRouter } from "./routes/messages";
import { createBatchesRouter } from "./routes/batches";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "anthropic-version",
      "anthropic-beta",
      "anthropic-dangerous-direct-browser-access",
    ],
  })
);

app.use(express.json({ limit: "50mb" }));

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
  console.error("OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

const openaiBaseUrl = process.env.OPENAI_BASE_URL;
const modelConfigPath = process.env.MODEL_CONFIG_PATH;

const modelManager = new ModelManager(modelConfigPath);
const openaiClientManager = new OpenAIClientManager(
  openaiApiKey,
  openaiBaseUrl
);
const claudeAdapter = new ClaudeAdapter(openaiClientManager.getClient());

const messagesRouter = createMessagesRouter({
  modelManager,
  claudeAdapter,
});

const batchesRouter = createBatchesRouter({
  modelManager,
  claudeAdapter,
});

app.use((req, res, next) => {
  console.log(`🔗 Request: ${req.method} ${req.originalUrl}`);
  next();
});

app.use("/v1/messages", messagesRouter);
app.use("/v1/messages/batches", batchesRouter);

app.get("/api/hello", (req, res) => {
  res.json({ message: "hello" });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Claude-compatible models endpoint
app.get("/v1/models", (req, res) => {
  const { beta } = req.query;

  const models = modelManager.getAllModels().map((model) => {
    // Use Anthropic's model info format
    return {
      id: model.claudeModelName,
      type: "model",
      display_name: model.description || model.claudeModelName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Anthropic-specific fields
      max_tokens: model.maxTokens,
      vision:
        model.claudeModelName.includes("vision") ||
        model.claudeModelName.includes("3-5"),
      tools: true,
      computer_use: model.claudeModelName.includes("3-5"),
      web_search: false,
      thinking:
        model.claudeModelName.includes("sonnet") ||
        model.claudeModelName.includes("opus"),
      // Additional metadata
      description: `${model.claudeModelName} - Claude model adapted via OpenAI`,
      context_length: model.maxTokens,
      // OpenAI compatibility fields for legacy clients
      object: "model",
      owned_by: "anthropic",
    };
  });

  if (beta === "true") {
    // Beta format with additional fields
    res.json({
      object: "list",
      data: models,
    });
  } else {
    // Standard format
    res.json({
      object: "list",
      data: models,
    });
  }
});

// Individual model retrieval
app.get("/v1/models/:modelId", (req, res) => {
  const { modelId } = req.params;
  const { beta } = req.query;

  const model = modelManager.getModelConfig(modelId);
  if (!model) {
    return res.status(404).json({
      type: "error",
      error: {
        type: "not_found_error",
        message: `Model ${modelId} not found`,
      },
    });
  }

  const modelInfo = {
    id: model.claudeModelName,
    type: "model",
    display_name: model.description || model.claudeModelName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    max_tokens: model.maxTokens,
    vision:
      model.claudeModelName.includes("vision") ||
      model.claudeModelName.includes("3-5"),
    tools: true,
    computer_use: model.claudeModelName.includes("3-5"),
    web_search: false,
    thinking:
      model.claudeModelName.includes("sonnet") ||
      model.claudeModelName.includes("opus"),
    description: `${model.claudeModelName} - Claude model adapted via OpenAI`,
    context_length: model.maxTokens,
    object: "model",
    owned_by: "anthropic",
  };

  res.json(modelInfo);
});

app.get("/", (req, res) => {
  res.json({
    message: "Claude API to OpenAI Adapter",
    version: "1.0.0",
    endpoints: {
      messages: "/v1/messages?beta=true",
      models: "/v1/models",
      health: "/health",
    },
    documentation: "https://docs.anthropic.com/en/api/messages",
  });
});

app.use((req, res) => {
  res.status(404).json({
    type: "error",
    error: {
      type: "not_found_error",
      message: `Endpoint ${req.method} ${req.path} not found`,
    },
  });
});

app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Unhandled error:", error);
    res.status(500).json({
      type: "error",
      error: {
        type: "api_error",
        message: "Internal server error",
      },
    });
  }
);

app.listen(port, () => {
  console.log(`🚀 Claude API to OpenAI Adapter running on port ${port}`);
  console.log(
    `📋 Available models: ${modelManager
      .getAllModels()
      .map((m) => m.claudeModelName)
      .join(", ")}`
  );
  console.log(
    `🔗 OpenAI Base URL: ${openaiBaseUrl || "https://api.openai.com/v1"}`
  );
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`📝 Models endpoint: http://localhost:${port}/v1/models`);
  console.log(
    `💬 Messages endpoint: http://localhost:${port}/v1/messages?beta=true`
  );

  if (modelConfigPath) {
    console.log(`⚙️  Model config: ${path.resolve(modelConfigPath)}`);

    if (!require("fs").existsSync(modelConfigPath)) {
      console.log(
        `📄 Generating example model config at ${modelConfigPath}...`
      );
      modelManager.generateExampleConfig(modelConfigPath);
    }
  } else {
    console.log("⚙️  Using default model configuration");
  }
});
