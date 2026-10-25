import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import {
  AssistantModelError,
  type AssistantModel,
  type ModelBlock,
  type ModelMessage,
  type ModelRequest,
  type ModelRound,
} from './assistant.types.js';

const MAX_OUTPUT_TOKENS = 4096;

function toParam(message: ModelMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map((block: ModelBlock): Anthropic.ContentBlockParam => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          };
      }
    }),
  };
}

/** Provider errors can carry request details: the user only ever sees one of these fixed sentences. */
const logger = new Logger('AnthropicAssistantModel');

function friendly(error: unknown): AssistantModelError {
  // operators get the status and type, never the body (it can echo parts of the request)
  if (error instanceof Anthropic.APIError)
    logger.warn(`Anthropic API error ${error.status ?? '?'} ${error.type ?? ''}`);
  else logger.warn(`Anthropic call failed: ${error instanceof Error ? error.name : 'unknown'}`);
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401 || error.status === 403) {
      return new AssistantModelError('The AI provider rejected the server API key.');
    }
    if (error.status === 429) {
      return new AssistantModelError('The AI provider is busy right now. Try again in a minute.');
    }
    if (error.status === 529 || (error.status ?? 0) >= 500) {
      return new AssistantModelError('The AI provider is overloaded or down. Try again later.');
    }
    if (error.status === 400) {
      return new AssistantModelError('The AI provider could not process this conversation.');
    }
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AssistantModelError('Could not reach the AI provider.');
  }
  return new AssistantModelError('The AI provider failed.');
}

/** The real model: Anthropic's Messages API, streamed. */
export class AnthropicAssistantModel implements AssistantModel {
  readonly configured: boolean;
  private readonly client?: Anthropic;

  constructor(private readonly options: { apiKey?: string; model: string }) {
    this.configured = Boolean(options.apiKey);
    if (options.apiKey) this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 2 });
  }

  async streamRound({
    system,
    messages,
    tools,
    signal,
    onText,
  }: ModelRequest): Promise<ModelRound> {
    if (!this.client) throw new AssistantModelError('The assistant is not configured.');
    const stream = this.client.messages.stream(
      {
        model: this.options.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
        messages: messages.map(toParam),
      },
      { signal },
    );
    stream.on('text', (delta) => onText(delta));

    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      // the caller checks `signal.aborted` first, so the raw abort error is fine to pass on
      if (signal.aborted) throw error;
      throw friendly(error);
    }

    const stopReason: ModelRound['stopReason'] =
      message.stop_reason === 'end_turn' ||
      message.stop_reason === 'tool_use' ||
      message.stop_reason === 'max_tokens' ||
      message.stop_reason === 'refusal'
        ? message.stop_reason
        : 'other';
    return {
      text: message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join(''),
      toolCalls: message.content.flatMap((block) =>
        block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : [],
      ),
      stopReason,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
