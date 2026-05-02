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
} from "@mariozechner/pi-ai";
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

function mapStopReason(reason: string | undefined): "stop" | "length" | "toolUse" | "error" {
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  return "error";
}

function toThinkingLevel(reasoning: SimpleStreamOptions["reasoning"]): "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | undefined {
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

function convertContext(context: Context): GeminiCliRequest["request"]["contents"] {
  const contents: GeminiCliRequest["request"]["contents"] = [];

  for (const message of context.messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        if (message.content.trim().length === 0) continue;
        contents.push({ role: "user", parts: [{ text: message.content }] });
        continue;
      }

      const parts = message.content.map((block) => {
        if (block.type === "text") {
          return { text: block.text };
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
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim().length > 0) {
          parts.push({ text: block.text, ...(block.textSignature ? { thoughtSignature: block.textSignature } : {}) });
        } else if (block.type === "thinking" && block.thinking.trim().length > 0) {
          parts.push({
            thought: true,
            text: block.thinking,
            ...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}),
          });
        } else if (block.type === "toolCall") {
          parts.push({
            functionCall: {
              id: block.id,
              name: block.name,
              args: block.arguments,
            },
            ...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (message.role === "toolResult") {
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: message.toolCallId,
              name: message.toolName,
              response: message.isError ? { error: text } : { output: text },
            },
          },
        ],
      });
    }
  }

  return contents;
}

function buildRequest(model: Model<Api>, context: Context, options: SimpleStreamOptions, projectId: string): GeminiCliRequest {
  const thinkingLevel = toThinkingLevel(options.reasoning);
  const generationConfig: GeminiCliRequest["request"]["generationConfig"] = {};
  if (typeof options.maxTokens === "number") generationConfig.maxOutputTokens = options.maxTokens;
  if (typeof options.temperature === "number") generationConfig.temperature = options.temperature;
  if (thinkingLevel) {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingLevel,
    };
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
      contents: convertContext(context),
      ...(context.systemPrompt ? { systemInstruction: { parts: [{ text: context.systemPrompt }] } } : {}),
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

      const response = await fetch(`${GEMINI_CLI_BASE_URL}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: {
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
        },
        body: JSON.stringify(requestBody),
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`Cloud Code Assist API error (${response.status}): ${await response.text()}`);
      }
      if (!response.body) {
        throw new Error("Cloud Code Assist API returned no response body.");
      }

      stream.push({ type: "start", partial: output });

      const blocks = output.content as StreamingBlock[];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let activeBlock: TextContent | ThinkingContent | null = null;
      let hasAnyContent = false;

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
                    stream.push({ type: "thinking_start", contentIndex: blocks.length - 1, partial: output });
                  } else {
                    activeBlock = { type: "text", text: "", textSignature: undefined };
                    blocks.push(activeBlock);
                    stream.push({ type: "text_start", contentIndex: blocks.length - 1, partial: output });
                  }
                }

                if (activeBlock.type === "thinking") {
                  activeBlock.thinking += part.text;
                  activeBlock.thinkingSignature = part.thoughtSignature || activeBlock.thinkingSignature;
                  stream.push({
                    type: "thinking_delta",
                    contentIndex: blocks.length - 1,
                    delta: part.text,
                    partial: output,
                  });
                } else {
                  activeBlock.text += part.text;
                  activeBlock.textSignature = part.thoughtSignature || activeBlock.textSignature;
                  stream.push({
                    type: "text_delta",
                    contentIndex: blocks.length - 1,
                    delta: part.text,
                    partial: output,
                  });
                }
              }

              if (part.functionCall) {
                hasAnyContent = true;
                closeActiveBlock();
                const toolCall: ToolCall = {
                  type: "toolCall",
                  id: part.functionCall.id || `${part.functionCall.name || "tool"}-${Date.now()}`,
                  name: part.functionCall.name || "unknown",
                  arguments: part.functionCall.args || {},
                  ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
                };
                blocks.push(toolCall);
                const contentIndex = blocks.length - 1;
                stream.push({ type: "toolcall_start", contentIndex, partial: output });
                stream.push({
                  type: "toolcall_delta",
                  contentIndex,
                  delta: JSON.stringify(toolCall.arguments),
                  partial: output,
                });
                stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
              }
            }
          }

          if (candidate?.finishReason) {
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

      closeActiveBlock();
      if (!hasAnyContent) {
        throw new Error("Cloud Code Assist API returned an empty stream.");
      }
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
