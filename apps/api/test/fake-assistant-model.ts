import type {
  AssistantModel,
  ModelRequest,
  ModelRound,
  TokenUsage,
} from '../src/assistant/assistant.types.js';

/** What one scripted model round does. */
export interface RoundScript {
  /** Streamed answer pieces, in order. */
  text?: string[];
  toolCalls?: { name: string; input: unknown }[];
  usage?: TokenUsage;
  /** Never answers: waits until the request is aborted (a slow model, to test a client that leaves). */
  hang?: boolean;
  /** Fails the round with this error. */
  error?: Error;
}

type Script = RoundScript | ((request: ModelRequest) => RoundScript);

/**
 * A model that follows a script, one entry per round, so no test needs a network or a key.
 * A script entry can be a function of the request, to use what earlier tool results said.
 */
export class FakeAssistantModel implements AssistantModel {
  configured = true;
  /** Copies of every request the loop sent (the loop keeps mutating its own message list). */
  requests: ModelRequest[] = [];
  /** True once a round saw its signal aborted. */
  sawAbort = false;
  private rounds: Script[] = [];
  private calls = 0;

  script(...rounds: Script[]) {
    this.rounds = rounds;
    this.requests = [];
    this.sawAbort = false;
    this.calls = 0;
    return this;
  }

  async streamRound(request: ModelRequest): Promise<ModelRound> {
    this.requests.push({ ...request, messages: structuredClone(request.messages) });
    const next = this.rounds.shift() ?? { text: ['(script ended)'] };
    const round = typeof next === 'function' ? next(request) : next;

    if (round.error) throw round.error;
    if (round.hang) {
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve();
        request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      this.sawAbort = true;
      throw new Error('aborted');
    }
    for (const delta of round.text ?? []) {
      request.onText(delta);
      // let the event loop turn, as a real stream would between tokens
      await new Promise((resolve) => setImmediate(resolve));
    }
    const toolCalls = (round.toolCalls ?? []).map((call) => ({
      id: `toolu_${++this.calls}`,
      name: call.name,
      input: call.input,
    }));
    return {
      text: (round.text ?? []).join(''),
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: round.usage ?? { inputTokens: 10, outputTokens: 5 },
    };
  }
}
