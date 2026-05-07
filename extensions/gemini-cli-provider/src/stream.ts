import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  calculateCost,
  createAssistantMessageEventStream,
  type Context,
  type Api,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  createUnsupportedModelError,
  GEMINI_CLI_BASE_URL,
  parseGeminiCliApiKey,
  validateGeminiCliModel,
} from "./types";

interface GeminiCliRequest {
  project: string;
  model: string;
  request: {
    contents: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }>;
    systemInstruction?: { parts: Array<{ text: string }> };
    generationConfig?: {
      maxOutputTokens?: number;
      temperature?: number;
      thinkingConfig?: {
        includeThoughts?: boolean;
        thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
        thinkingBudget?: number;
      };
    };
    tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
  };
}

interface GeminiCliChunk {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thought?: boolean;
          thoughtSignature?: string;
          functionCall?: {
            id?: string;
            name?: string;
            args?: Record<string, unknown>;
          };
        }>;
      };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
      totalTokenCount?: number;
    };
    responseId?: string;
  };
}

type StreamingBlock = (TextContent | ThinkingContent | ToolCall) & { index?: number };

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_EMPTY_STREAM_RETRIES = 2;
const EMPTY_STREAM_BASE_DELAY_MS = 500;
let toolCallCounter = 0;

function sanitizeSurrogates(value: string): string {
  return value
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request was aborted."));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Request was aborted."));
    });
  });
}

function extractErrorMessage(errorText: string): string {
  try {
    const parsed = JSON.parse(errorText) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // pass
  }
  return errorText;
}

function extractRetryDelay(errorText: string, response?: Response): number | undefined {
  const normalizeDelay = (ms: number): number | undefined => (ms > 0 ? Math.ceil(ms + 1000) : undefined);

  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds)) {
      const delay = normalizeDelay(retryAfterSeconds * 1000);
      if (delay !== undefined) return delay;
    }

    const retryAfterDate = new Date(retryAfter);
    const retryAfterMs = retryAfterDate.getTime();
    if (!Number.isNaN(retryAfterMs)) {
      const delay = normalizeDelay(retryAfterMs - Date.now());
      if (delay !== undefined) return delay;
    }
  }

  const rateLimitReset = response?.headers.get("x-ratelimit-reset");
  if (rateLimitReset) {
    const resetSeconds = Number.parseInt(rateLimitReset, 10);
    if (!Number.isNaN(resetSeconds)) {
      const delay = normalizeDelay(resetSeconds * 1000 - Date.now());
      if (delay !== undefined) return delay;
    }
  }

  const rateLimitResetAfter = response?.headers.get("x-ratelimit-reset-after");
  if (rateLimitResetAfter) {
    const resetAfterSeconds = Number(rateLimitResetAfter);
    if (Number.isFinite(resetAfterSeconds)) {
      const delay = normalizeDelay(resetAfterSeconds * 1000);
      if (delay !== undefined) return delay;
    }
  }

  const durationMatch = errorText.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  if (durationMatch) {
    const hours = durationMatch[1] ? Number.parseInt(durationMatch[1], 10) : 0;
    const minutes = durationMatch[2] ? Number.parseInt(durationMatch[2], 10) : 0;
    const seconds = Number.parseFloat(durationMatch[3]);
    if (!Number.isNaN(seconds)) {
      const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
      const delay = normalizeDelay(totalMs);
      if (delay !== undefined) return delay;
    }
  }

  const retryInMatch = errorText.match(/Please retry in ([0-9.]+)(ms|s)/i);
  if (retryInMatch?.[1]) {
    const value = Number.parseFloat(retryInMatch[1]);
    if (!Number.isNaN(value) && value > 0) {
      const delay = normalizeDelay(retryInMatch[2].toLowerCase() === "ms" ? value : value * 1000);
      if (delay !== undefined) return delay;
    }
  }

  const retryDelayMatch = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
  if (retryDelayMatch?.[1]) {
    const value = Number.parseFloat(retryDelayMatch[1]);
    if (!Number.isNaN(value) && value > 0) {
      const delay = normalizeDelay(retryDelayMatch[2].toLowerCase() === "ms" ? value : value * 1000);
      if (delay !== undefined) return delay;
    }
  }

  return undefined;
}

function isRetryableError(status: number, errorText: string): boolean {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return /resource.?exhausted|rate.?limit|overloaded|service.?unavailable|other.?side.?closed/i.test(errorText);
}

function mapStopReason(reason: string | undefined): "stop" | "length" | "toolUse" | "error" {
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  return "error";
}

function isGemini3ProModel(modelId: string): boolean {
  return /gemini-3(?:\.1)?-pro/.test(modelId.toLowerCase());
}

function isGemini3FlashModel(modelId: string): boolean {
  return /gemini-3(?:\.1)?-flash/.test(modelId.toLowerCase());
}

function toThinkingLevel(
  modelId: string,
  reasoning: SimpleStreamOptions["reasoning"],
): "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | undefined {
  if (isGemini3ProModel(modelId)) {
    switch (reasoning) {
      case "minimal":
      case "low":
        return "LOW";
      case "medium":
      case "high":
        return "HIGH";
      default:
        return undefined;
    }
  }

  switch (reasoning) {
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
    default:
      return undefined;
  }
}

function getDisabledThinkingConfig(modelId: string): { thinkingLevel?: "MINIMAL" | "LOW"; thinkingBudget?: number } {
  if (isGemini3ProModel(modelId)) return { thinkingLevel: "LOW" };
  if (isGemini3FlashModel(modelId)) return { thinkingLevel: "MINIMAL" };
  return { thinkingBudget: 0 };
}

const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;

function isGemini3ModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("gemini-3");
}

function isValidThoughtSignature(signature: string | undefined): boolean {
  if (!signature) return false;
  if (signature.length % 4 !== 0) return false;
  return base64SignaturePattern.test(signature);
}

function resolveThoughtSignature(isSameProviderAndModel: boolean, signature: string | undefined): string | undefined {
  return isSameProviderAndModel && isValidThoughtSignature(signature) ? signature : undefined;
}

function convertContext(model: Model<Api>, context: Context): GeminiCliRequest["request"]["contents"] {
  const contents: GeminiCliRequest["request"]["contents"] = [];
  const gemini3 = isGemini3ModelId(model.id);
  let pendingToolResponses: Array<Record<string, unknown>> = [];

  const flushToolResponses = () => {
    if (pendingToolResponses.length === 0) return;
    contents.push({ role: "user", parts: pendingToolResponses });
    pendingToolResponses = [];
  };

  for (const message of context.messages) {
    if (message.role === "toolResult") {
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      pendingToolResponses.push({
        functionResponse: {
          id: message.toolCallId,
          name: message.toolName,
          response: message.isError ? { error: sanitizeSurrogates(text) } : { output: sanitizeSurrogates(text) },
        },
      });
      continue;
    }

    flushToolResponses();

    if (message.role === "user") {
      if (typeof message.content === "string") {
        if (message.content.trim().length === 0) continue;
        contents.push({ role: "user", parts: [{ text: sanitizeSurrogates(message.content) }] });
        continue;
      }

      const parts = message.content.map((block) => {
        if (block.type === "text") {
          return { text: sanitizeSurrogates(block.text) };
        }
        return {
          inlineData: {
            mimeType: block.mimeType,
            data: block.data,
          },
        };
      });
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      const isSameProviderAndModel = message.provider === model.provider && message.model === model.id;

      for (const block of message.content) {
        if (block.type === "text" && block.text.trim().length > 0) {
          const thoughtSignature = resolveThoughtSignature(isSameProviderAndModel, block.textSignature);
          parts.push({ text: sanitizeSurrogates(block.text), ...(thoughtSignature ? { thoughtSignature } : {}) });
        } else if (block.type === "thinking" && block.thinking.trim().length > 0) {
          if (isSameProviderAndModel) {
            const thoughtSignature = resolveThoughtSignature(isSameProviderAndModel, block.thinkingSignature);
            parts.push({
              thought: true,
              text: sanitizeSurrogates(block.thinking),
              ...(thoughtSignature ? { thoughtSignature } : {}),
            });
          } else {
            parts.push({ text: sanitizeSurrogates(block.thinking) });
          }
        } else if (block.type === "toolCall") {
          const thoughtSignature = resolveThoughtSignature(isSameProviderAndModel, block.thoughtSignature);
          const effectiveThoughtSignature = thoughtSignature || (gemini3 ? SKIP_THOUGHT_SIGNATURE : undefined);
          parts.push({
            functionCall: {
              id: block.id,
              name: block.name,
              args: block.arguments,
            },
            ...(effectiveThoughtSignature ? { thoughtSignature: effectiveThoughtSignature } : {}),
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
    }
  }

  flushToolResponses();

  return contents;
}

function buildRequest(model: Model<Api>, context: Context, options: SimpleStreamOptions, projectId: string): GeminiCliRequest {
  const thinkingLevel = toThinkingLevel(model.id, options.reasoning);
  const generationConfig: GeminiCliRequest["request"]["generationConfig"] = {};
  if (typeof options.maxTokens === "number") generationConfig.maxOutputTokens = options.maxTokens;
  if (typeof options.temperature === "number") generationConfig.temperature = options.temperature;
  if (thinkingLevel) {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingLevel,
    };
  } else if (model.reasoning) {
    generationConfig.thinkingConfig = getDisabledThinkingConfig(model.id);
  }

  const tools = context.tools?.map((tool) => ({
    functionDeclarations: [
      {
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      },
    ],
  }));

  return {
    project: projectId,
    model: model.id,
    request: {
      contents: convertContext(model, context),
      ...(context.systemPrompt ? { systemInstruction: { parts: [{ text: sanitizeSurrogates(context.systemPrompt) }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
    },
  };
}

export function streamGeminiCli(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      validateGeminiCliModel(model);
      const credentials = parseGeminiCliApiKey(options?.apiKey);
      const requestBody = buildRequest(model, context, options ?? {}, credentials.projectId);
      const requestHeaders = {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": "GeminiCLI/0.35.3/gemini-3.1-pro-preview (linux; x64; terminal) google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": "gl-node/22.17.0",
        "Client-Metadata": JSON.stringify({
          ideType: "IDE_UNSPECIFIED",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
        }),
      };
      const requestUrl = `${GEMINI_CLI_BASE_URL}/v1internal:streamGenerateContent?alt=sse`;

      let response: Response | undefined;
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (options?.signal?.aborted) throw new Error("Request was aborted.");
        try {
          response = await fetch(requestUrl, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal: options?.signal,
          });

          if (response.ok) break;

          const errorText = await response.text();
          if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
            const delay = extractRetryDelay(errorText, response) ?? BASE_DELAY_MS * 2 ** attempt;
            await sleep(delay, options?.signal);
            continue;
          }

          throw new Error(`Cloud Code Assist API error (${response.status}): ${extractErrorMessage(errorText)}`);
        } catch (error) {
          if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted.")) {
            throw new Error("Request was aborted.");
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < MAX_RETRIES) {
            await sleep(BASE_DELAY_MS * 2 ** attempt, options?.signal);
            continue;
          }
          throw lastError;
        }
      }

      if (!response?.ok) {
        throw lastError ?? new Error("Failed to get response after retries.");
      }

      let started = false;
      const ensureStarted = () => {
        if (started) return;
        stream.push({ type: "start", partial: output });
        started = true;
      };

      const streamResponse = async (activeResponse: Response): Promise<boolean> => {
        if (!activeResponse.body) throw new Error("Cloud Code Assist API returned no response body.");

        const blocks = output.content as StreamingBlock[];
        const reader = activeResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let activeBlock: TextContent | ThinkingContent | null = null;
        let hasAnyContent = false;
        const pendingToolCalls = new Map<string, ToolCall>();
        const pendingToolCallOrder: string[] = [];

        const abortHandler = () => {
          void reader.cancel().catch(() => {});
        };
        options?.signal?.addEventListener("abort", abortHandler);

        const closeActiveBlock = () => {
          if (!activeBlock) return;
          const index = blocks.length - 1;
          if (activeBlock.type === "text") {
            stream.push({ type: "text_end", contentIndex: index, content: activeBlock.text, partial: output });
          } else {
            stream.push({ type: "thinking_end", contentIndex: index, content: activeBlock.thinking, partial: output });
          }
          activeBlock = null;
        };

        const flushPendingToolCalls = () => {
          for (const key of pendingToolCallOrder) {
            const toolCall = pendingToolCalls.get(key);
            if (!toolCall) continue;
            blocks.push(toolCall);
            const contentIndex = blocks.length - 1;
            ensureStarted();
            stream.push({ type: "toolcall_start", contentIndex, partial: output });
            stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(toolCall.arguments), partial: output });
            stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
          }
          pendingToolCalls.clear();
          pendingToolCallOrder.length = 0;
        };

        try {
          while (true) {
            if (options?.signal?.aborted) throw new Error("Request was aborted.");
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;

              let chunk: GeminiCliChunk;
              try {
                chunk = JSON.parse(payload) as GeminiCliChunk;
              } catch {
                continue;
              }

              const candidate = chunk.response?.candidates?.[0];
              if (chunk.response?.responseId) {
                output.responseId = output.responseId || chunk.response.responseId;
              }

              if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                  if (typeof part.text === "string") {
                    hasAnyContent = true;
                    const isThinking = part.thought === true;
                    if (!activeBlock || (isThinking && activeBlock.type !== "thinking") || (!isThinking && activeBlock.type !== "text")) {
                      closeActiveBlock();
                      if (isThinking) {
                        activeBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
                        blocks.push(activeBlock);
                        ensureStarted();
                        stream.push({ type: "thinking_start", contentIndex: blocks.length - 1, partial: output });
                      } else {
                        activeBlock = { type: "text", text: "", textSignature: undefined };
                        blocks.push(activeBlock);
                        ensureStarted();
                        stream.push({ type: "text_start", contentIndex: blocks.length - 1, partial: output });
                      }
                    }

                    if (activeBlock.type === "thinking") {
                      activeBlock.thinking += part.text;
                      activeBlock.thinkingSignature = part.thoughtSignature || activeBlock.thinkingSignature;
                      stream.push({ type: "thinking_delta", contentIndex: blocks.length - 1, delta: part.text, partial: output });
                    } else {
                      activeBlock.text += part.text;
                      activeBlock.textSignature = part.thoughtSignature || activeBlock.textSignature;
                      stream.push({ type: "text_delta", contentIndex: blocks.length - 1, delta: part.text, partial: output });
                    }
                  }

                  if (part.functionCall) {
                    hasAnyContent = true;
                    closeActiveBlock();

                    const fallbackKey = `__noid_${part.functionCall.name || "tool"}`;
                    const key = part.functionCall.id || fallbackKey;
                    let existing = pendingToolCalls.get(key);

                    if (!existing) {
                      const providedId = part.functionCall.id;
                      const needsNewId =
                        !providedId ||
                        blocks.some((b) => b.type === "toolCall" && b.id === providedId) ||
                        Array.from(pendingToolCalls.values()).some((b) => b.id === providedId);
                      const toolCallId = needsNewId
                        ? `${part.functionCall.name || "tool"}_${Date.now()}_${++toolCallCounter}`
                        : providedId;

                      existing = {
                        type: "toolCall",
                        id: toolCallId,
                        name: part.functionCall.name || "unknown",
                        arguments: {},
                        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
                      };
                      pendingToolCalls.set(key, existing);
                      pendingToolCallOrder.push(key);
                    }

                    existing.name = part.functionCall.name || existing.name;
                    existing.arguments = {
                      ...existing.arguments,
                      ...(part.functionCall.args || {}),
                    };
                    if (part.thoughtSignature) {
                      existing.thoughtSignature = part.thoughtSignature;
                    }
                  }
                }
              }

              if (candidate?.finishReason) {
                closeActiveBlock();
                flushPendingToolCalls();
                output.stopReason = mapStopReason(candidate.finishReason);
                if (output.content.some((block) => block.type === "toolCall")) {
                  output.stopReason = "toolUse";
                }
              }

              if (chunk.response?.usageMetadata) {
                const promptTokens = chunk.response.usageMetadata.promptTokenCount || 0;
                const cacheRead = chunk.response.usageMetadata.cachedContentTokenCount || 0;
                output.usage.input = promptTokens - cacheRead;
                output.usage.output =
                  (chunk.response.usageMetadata.candidatesTokenCount || 0) +
                  (chunk.response.usageMetadata.thoughtsTokenCount || 0);
                output.usage.cacheRead = cacheRead;
                output.usage.cacheWrite = 0;
                output.usage.totalTokens = chunk.response.usageMetadata.totalTokenCount || 0;
                calculateCost(model, output.usage);
              }
            }
          }
        } finally {
          options?.signal?.removeEventListener("abort", abortHandler);
        }

        closeActiveBlock();
        flushPendingToolCalls();
        return hasAnyContent;
      };

      let hasContent = false;
      let activeResponse = response;
      for (let i = 0; i <= MAX_EMPTY_STREAM_RETRIES; i++) {
        hasContent = await streamResponse(activeResponse);
        if (hasContent) break;

        if (i < MAX_EMPTY_STREAM_RETRIES) {
          output.content = [];
          output.usage = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          output.stopReason = "stop";
          output.errorMessage = undefined;
          output.timestamp = Date.now();
          started = false;

          await sleep(EMPTY_STREAM_BASE_DELAY_MS * 2 ** i, options?.signal);
          activeResponse = await fetch(requestUrl, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal: options?.signal,
          });
          if (!activeResponse.ok) {
            throw new Error(`Cloud Code Assist API error (${activeResponse.status}): ${await activeResponse.text()}`);
          }
        }
      }

      if (!hasContent) throw new Error("Cloud Code Assist API returned an empty stream.");
      if (output.stopReason === "error" || output.stopReason === "aborted") {
        throw new Error("Cloud Code Assist API returned a non-success stop reason.");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content as StreamingBlock[]) {
        delete block.index;
      }
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error
          ? error.message
          : error && typeof error === "object" && "message" in error && typeof error.message === "string"
            ? error.message
            : JSON.stringify(error);

      if (!createUnsupportedModelError || !model.id) {
        // no-op guard to keep the unsupported-model helper as an explicit dependency of this dedicated stream.
      }

      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
