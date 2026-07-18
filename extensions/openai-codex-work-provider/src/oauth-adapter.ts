import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/oauth";

export interface OpenAICodexOAuth {
  login(interaction: OAuthInteraction): Promise<OAuthCredential>;
  refresh(
    credential: OAuthCredential,
    signal?: AbortSignal,
  ): Promise<OAuthCredential>;
  toAuth(credential: OAuthCredential): Promise<unknown>;
}

interface OAuthInteraction {
  signal?: AbortSignal;
  prompt(prompt: {
    type: "text" | "secret" | "select" | "manual_code";
    message: string;
    placeholder?: string;
    options?: readonly { id: string; label: string; description?: string }[];
  }): Promise<string>;
  notify(event:
    | { type: "auth_url"; url: string; instructions?: string }
    | {
        type: "device_code";
        userCode: string;
        verificationUri: string;
        intervalSeconds?: number;
        expiresInSeconds?: number;
      }
    | { type: "progress"; message: string },
  ): void;
}

export function createOAuthAdapter(oauth: OpenAICodexOAuth) {
  return {
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      return oauth.login({
        signal: callbacks.signal,
        async prompt(prompt) {
          switch (prompt.type) {
            case "select":
              return (await callbacks.onSelect({
                message: prompt.message,
                options: [...(prompt.options ?? [])].map(({ id, label }) => ({
                  id,
                  label,
                })),
              })) ?? "";
            case "manual_code":
              if (callbacks.onManualCodeInput) {
                return callbacks.onManualCodeInput();
              }
              return callbacks.onPrompt({
                message: prompt.message,
                placeholder: prompt.placeholder,
              });
            default:
              return callbacks.onPrompt({
                message: prompt.message,
                placeholder: prompt.placeholder,
              });
          }
        },
        notify(event) {
          switch (event.type) {
            case "auth_url":
              callbacks.onAuth({
                url: event.url,
                instructions: event.instructions,
              });
              break;
            case "device_code":
              callbacks.onDeviceCode(event);
              break;
            case "progress":
              callbacks.onProgress?.(event.message);
              break;
          }
        },
      });
    },
    refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      return oauth.refresh(credentials as OAuthCredential);
    },
    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },
  };
}

export function isOpenAICodexOAuth(value: unknown): value is OpenAICodexOAuth {
  if (!value || typeof value !== "object") return false;
  const oauth = value as Partial<OAuthAuth>;
  return (
    typeof oauth.login === "function" &&
    typeof oauth.refresh === "function" &&
    typeof oauth.toAuth === "function"
  );
}
