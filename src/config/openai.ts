import OpenAI from 'openai';

export class OpenAIClientManager {
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1'
    });

    console.log(`OpenAI client initialized with base URL: ${baseURL || 'https://api.openai.com/v1'}`);
  }

  getClient(): OpenAI {
    return this.client;
  }

  updateConfig(apiKey: string, baseURL?: string): void {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1'
    });

    console.log(`OpenAI client configuration updated`);
  }
}