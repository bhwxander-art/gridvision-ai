import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ChatMessage } from "./types";

function classifyError(err: unknown): Error {
  if (err instanceof Anthropic.RateLimitError) {
    return new Error("Rate limit reached. Please try again in a moment.");
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error("AI service authentication failed. Check ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new Error("AI request timed out. Please try again.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error("Could not reach AI service. Check network connectivity.");
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`AI service error (${err.status}): ${err.message}`);
  }
  if (err instanceof Error) return err;
  return new Error("Unknown AI error");
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic/claude-sonnet-4-6";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *stream(
    systemPrompt: string,
    messages: ChatMessage[],
    options?: { signal?: AbortSignal }
  ): AsyncIterable<string> {
    try {
      const stream = this.client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      for await (const event of stream) {
        if (options?.signal?.aborted) return;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    } catch (err) {
      throw classifyError(err);
    }
  }

  async complete(systemPrompt: string, messages: ChatMessage[]): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const block = response.content[0];
      return block?.type === "text" ? block.text : "";
    } catch (err) {
      throw classifyError(err);
    }
  }
}
