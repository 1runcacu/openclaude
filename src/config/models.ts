import fs from 'fs';

export interface ModelConfig {
  claudeModelName: string;
  openaiModelName: string;
  maxTokens: number;
  description?: string;
}

export interface RouterConfig {
  default: string;
  longContext?: string;
  longContextThreshold?: number;
  webSearch?: string;
  background?: string;
  think?: string;
}

export interface ModelConfigFile {
  models: ModelConfig[];
  defaultModel?: string;
  router?: RouterConfig;
}

const DEFAULT_MODELS: ModelConfig[] = [
  {
    claudeModelName: 'claude-3-5-sonnet-20241022',
    openaiModelName: 'gpt-4o',
    maxTokens: 8192,
    description: 'Claude 3.5 Sonnet mapped to GPT-4o'
  },
  {
    claudeModelName: 'claude-3-5-haiku-20241022',
    openaiModelName: 'gpt-4o-mini',
    maxTokens: 8192,
    description: 'Claude 3.5 Haiku mapped to GPT-4o Mini'
  },
  {
    claudeModelName: 'claude-3-opus-20240229',
    openaiModelName: 'gpt-4-turbo',
    maxTokens: 4096,
    description: 'Claude 3 Opus mapped to GPT-4 Turbo'
  },
  {
    claudeModelName: 'claude-3-sonnet-20240229',
    openaiModelName: 'gpt-4',
    maxTokens: 4096,
    description: 'Claude 3 Sonnet mapped to GPT-4'
  },
  {
    claudeModelName: 'claude-3-haiku-20240307',
    openaiModelName: 'gpt-3.5-turbo',
    maxTokens: 4096,
    description: 'Claude 3 Haiku mapped to GPT-3.5 Turbo'
  }
];

export class ModelManager {
  private models: Map<string, ModelConfig> = new Map();
  private defaultModel: string | undefined;
  private routerConfig: RouterConfig | undefined;

  constructor(configPath?: string) {
    this.loadModels(configPath);
  }

  private loadModels(configPath?: string) {
    let config: ModelConfigFile;

    if (configPath && fs.existsSync(configPath)) {
      try {
        const configData = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configData);
      } catch (error) {
        console.error(`Error reading model config from ${configPath}:`, error);
        config = { models: DEFAULT_MODELS };
      }
    } else {
      config = { models: DEFAULT_MODELS };
    }

    config.models.forEach(model => {
      this.models.set(model.claudeModelName, model);
    });

    this.defaultModel = config.defaultModel || config.models[0]?.claudeModelName;
    this.routerConfig = config.router || {
      default: this.defaultModel || 'claude-3-5-sonnet-20241022',
      longContextThreshold: 60000
    };
  }

  getModelConfig(claudeModelName: string): ModelConfig | undefined {
    return this.models.get(claudeModelName);
  }

  getAllModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  getDefaultModel(): string | undefined {
    return this.defaultModel;
  }

  getRouterConfig(): RouterConfig | undefined {
    return this.routerConfig;
  }

  addModel(config: ModelConfig): void {
    this.models.set(config.claudeModelName, config);
  }

  removeModel(claudeModelName: string): boolean {
    return this.models.delete(claudeModelName);
  }

  saveConfig(configPath: string): void {
    const config: ModelConfigFile = {
      models: Array.from(this.models.values()),
      defaultModel: this.defaultModel
    };

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error(`Error saving model config to ${configPath}:`, error);
    }
  }

  generateExampleConfig(configPath: string): void {
    const config: ModelConfigFile = {
      models: DEFAULT_MODELS,
      defaultModel: DEFAULT_MODELS[0].claudeModelName
    };

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error(`Error creating example config at ${configPath}:`, error);
    }
  }
}