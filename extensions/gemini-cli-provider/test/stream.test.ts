import { describe, expect, it, vi } from "vitest";
import type { Api, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
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

function testContext(): Context {
	return {
		systemPrompt: "",
		messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		tools: [],
	};
}

async function collectEvents(stream: ReturnType<typeof streamGeminiCli>): Promise<string[]> {
	const events: string[] = [];
	for await (const event of stream) {
		events.push(event.type);
	}
	return events;
}

describe("gemini-cli dedicated stream", () => {
	it("fails unsupported models explicitly", async () => {
		const stream = streamGeminiCli(testModel("legacy-model"), testContext(), {
			apiKey: JSON.stringify({ token: "token", projectId: "project" }),
		} satisfies SimpleStreamOptions);

		const events = await collectEvents(stream);
		expect(events).toContain("error");
	});

	it("targets fixed cloudcode endpoint and emits done on successful SSE", async () => {
		const sseBody = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(
					encoder.encode(
						'data: {"response":{"responseId":"rid-1","candidates":[{"content":{"parts":[{"text":"hi"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}}\n\n',
					),
				);
				controller.close();
			},
		});

		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, body: sseBody }));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const stream = streamGeminiCli(testModel(), testContext(), {
				apiKey: JSON.stringify({ token: "token", projectId: "project" }),
			} satisfies SimpleStreamOptions);
			const events = await collectEvents(stream);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String((fetchMock as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0])).toBe(
				"https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
			);
			expect(events[0]).toBe("start");
			expect(events).toContain("text_start");
			expect(events).toContain("text_delta");
			expect(events).toContain("text_end");
			expect(events).toContain("done");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
