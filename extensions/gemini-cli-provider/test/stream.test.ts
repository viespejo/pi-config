import { describe, expect, it, vi } from "vitest";
import {
  normalizeContext,
  type Api,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { streamGeminiCli } from "../src/stream";

function testModel(id = "gemini-3.1-pro-preview"): Model<Api> {
  return {
    id,
    name: id,
    api: "google-gemini-cli",
    provider: "google-gemini-cli",
    baseUrl: "https://cloudcode-pa.googleapis.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 64000,
  };
}

function testContext(options: { prompt?: string; withTool?: boolean } = {}): TranscriptContext {
  return normalizeContext({
    systemPrompt: options.prompt ?? "",
    messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    tools: options.withTool
      ? [
          {
            name: "audit_tool",
            description: "Audit tool",
            parameters: Type.Object({ value: Type.String() }),
          },
        ]
      : [],
  });
}

function successResponse(text = "hi"): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            response: {
              responseId: "rid-1",
              candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
              usageMetadata: {
                promptTokenCount: 4,
                candidatesTokenCount: 2,
                totalTokenCount: 6,
              },
            },
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "x-request-id": "request-1" } });
}

async function collectEventObjects(stream: ReturnType<typeof streamGeminiCli>) {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const event of stream) {
    events.push(event as unknown as { type: string; [key: string]: unknown });
  }
  return events;
}

async function collectEvents(stream: ReturnType<typeof streamGeminiCli>): Promise<string[]> {
  return (await collectEventObjects(stream)).map((event) => event.type);
}

describe("gemini-cli dedicated stream", () => {
  it("fails unsupported models explicitly", async () => {
    const stream = streamGeminiCli(testModel("legacy-model"), testContext(), {
      apiKey: JSON.stringify({ token: "token", projectId: "project" }),
    } satisfies SimpleStreamOptions);

    const events = await collectEvents(stream);
    expect(events).toEqual(["error"]);
  });

  it("targets the fixed cloudcode endpoint and emits a balanced successful stream", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successResponse());
    const stream = streamGeminiCli(testModel(), testContext(), {
      apiKey: JSON.stringify({ token: "token", projectId: "project" }),
      fetch: fetchMock as typeof fetch,
    } satisfies SimpleStreamOptions);

    const events = await collectEvents(stream);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
    );
    expect(events).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
  });

  it("uses normalized prompt and tools and invokes request instrumentation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successResponse("ok"));
    const onPayload = vi.fn((payload: unknown) => ({ ...(payload as object), auditMarker: true }));
    const onResponse = vi.fn();
    const onProviderStreamEvent = vi.fn();

    const stream = streamGeminiCli(
      testModel(),
      testContext({ prompt: "SYSTEM_MARKER", withTool: true }),
      {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
        onPayload,
        onResponse,
        onProviderStreamEvent,
      } satisfies SimpleStreamOptions,
    );
    await collectEvents(stream);

    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onProviderStreamEvent).toHaveBeenCalledTimes(1);

    const request = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(request.auditMarker).toBe(true);
    expect(request.request.systemInstruction.parts[0].text).toBe("SYSTEM_MARKER");
    expect(request.request.tools[0].functionDeclarations[0].name).toBe("audit_tool");
  });

  it("converts tool results and emits a valid tool call", async () => {
    const context = testContext({ withTool: true });
    context.messages.push(
      {
        role: "assistant",
        api: "google-gemini-cli",
        provider: "google-gemini-cli",
        model: "gemini-3.1-pro-preview",
        content: [
          {
            type: "toolCall",
            id: "previous-call",
            name: "audit_tool",
            arguments: { value: "before" },
          },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "previous-call",
        toolName: "audit_tool",
        content: [{ type: "text", text: "previous result" }],
        isError: false,
        timestamp: Date.now(),
      },
    );

    const providerEvent = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: "next-call",
                    name: "audit_tool",
                    args: { value: "after" },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(`data: ${JSON.stringify(providerEvent)}\n\n`, { status: 200 });
    });

    const events = await collectEventObjects(
      streamGeminiCli(testModel(), context, {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    const toolEnd = events.find((event) => event.type === "toolcall_end");
    expect(toolEnd?.toolCall).toMatchObject({
      id: "next-call",
      name: "audit_tool",
      arguments: { value: "after" },
    });

    const request = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const responsePart = request.request.contents
      .flatMap((content: { parts: unknown[] }) => content.parts)
      .find((part: { functionResponse?: unknown }) => part.functionResponse);
    expect(responsePart.functionResponse).toMatchObject({
      id: "previous-call",
      name: "audit_tool",
      response: { output: "previous result" },
    });
  });

  it("returns an aborted terminal event when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successResponse());

    const events = await collectEventObjects(
      streamGeminiCli(testModel(), testContext(), {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
        signal: controller.signal,
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", reason: "aborted" });
  });

  it("retries empty streams and emits only one start event", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("", { status: 200 });
    });

    const events = await collectEvents(
      streamGeminiCli(testModel(), testContext(), {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events.filter((type) => type === "start")).toHaveLength(1);
    expect(events.at(-1)).toBe("error");
  }, 5000);

  it("handles malformed events and Unicode split across byte chunks", async () => {
    const text = "hello 🌍";
    const payload = `data: not-json\n\ndata: ${JSON.stringify({
      response: {
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      },
    })}\n\n`;
    const encoded = new TextEncoder().encode(payload);
    const emojiStart = encoded.findIndex((value, index) =>
      value === 0xf0 && encoded[index + 1] === 0x9f,
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, emojiStart + 2));
        controller.enqueue(encoded.slice(emojiStart + 2));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(body, { status: 200 });
    });

    const events = await collectEventObjects(
      streamGeminiCli(testModel(), testContext(), {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
      }),
    );

    const done = events.find((event) => event.type === "done") as
      | { message?: { content?: Array<{ type: string; text?: string }> } }
      | undefined;
    expect(done?.message?.content?.[0]?.text).toBe(text);
  });

  it("reports usage and cost on the terminal message", async () => {
    const model = testModel();
    model.cost = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successResponse());

    const events = await collectEventObjects(
      streamGeminiCli(model, testContext(), {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
      }),
    );
    const done = events.find((event) => event.type === "done") as
      | { message?: { usage?: { input: number; output: number; totalTokens: number; cost: { total: number } } } }
      | undefined;

    expect(done?.message?.usage).toMatchObject({ input: 4, output: 2, totalTokens: 6 });
    expect(done?.message?.usage?.cost.total).toBeGreaterThan(0);
  });

  it("does not retry non-retryable HTTP errors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    });

    const events = await collectEvents(
      streamGeminiCli(testModel(), testContext(), {
        apiKey: JSON.stringify({ token: "token", projectId: "project" }),
        fetch: fetchMock as typeof fetch,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["error"]);
  });
});
