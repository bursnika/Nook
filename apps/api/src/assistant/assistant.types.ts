/** A conversation as the model sees it: our own shapes, so nothing outside the Anthropic adapter knows the SDK. */
export type ModelBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | ModelBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  /** Aborted when the client goes away: the model call must stop. */
  signal: AbortSignal;
  /** Called for every streamed piece of the answer text. */
  onText: (delta: string) => void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** What one model round produced. A round with tool calls is followed by another round. */
export interface ModelRound {
  text: string;
  toolCalls: ModelToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage?: TokenUsage;
}

/** The language model behind the assistant; tests plug in a scripted one. */
export interface AssistantModel {
  /** False when there is no API key: the endpoint then answers 503 before streaming. */
  readonly configured: boolean;
  streamRound(request: ModelRequest): Promise<ModelRound>;
}

export const ASSISTANT_MODEL = Symbol('ASSISTANT_MODEL');

/** A failure of the model call whose message is safe to show to the user (no keys, no raw provider bodies). */
export class AssistantModelError extends Error {}

/** What a tool hands back: `content` goes to the model, `summary` to the user's timeline. */
export interface ToolOutcome {
  ok: boolean;
  content: string;
  summary: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The server-sent events of one answer, with the payload of each. */
export type AssistantEvent =
  | { event: 'step'; data: { n: number; label: string } }
  | { event: 'text'; data: { delta: string } }
  | { event: 'tool_call'; data: { id: string; name: string; input: unknown } }
  | { event: 'tool_result'; data: { id: string; name: string; ok: boolean; summary: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: { usage?: TokenUsage } };
