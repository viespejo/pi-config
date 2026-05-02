import { createServer, type Server } from "node:http";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { ProviderConfig } from "@mariozechner/pi-coding-agent";
import type { GeminiCliCredentials } from "./types";

const decode = (value: string) => atob(value);
const CLIENT_ID = decode(
  "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const CLIENT_SECRET = decode("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");
const REDIRECT_URI = "http://localhost:8085/oauth2callback";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CALLBACK_HOST = process.env.PI_OAUTH_CALLBACK_HOST || "127.0.0.1";

interface CallbackServerInfo {
  server: Server;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string; state: string } | null>;
}

interface LoadCodeAssistPayload {
  cloudaicompanionProject?: string;
  currentTier?: { id?: string };
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

interface LongRunningOperationResponse {
  name?: string;
  done?: boolean;
  response?: {
    cloudaicompanionProject?: { id?: string };
  };
}

interface GoogleRpcErrorResponse {
  error?: {
    details?: Array<{ reason?: string }>;
  };
}

const TIER_FREE = "free-tier";
const TIER_LEGACY = "legacy-tier";
const TIER_STANDARD = "standard-tier";

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const verifier = btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { verifier, challenge };
}

function parseRedirectUrl(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    return {};
  }
}

async function startCallbackServer(): Promise<CallbackServerInfo> {
  return new Promise((resolve, reject) => {
    let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;
    const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait) => {
      let settled = false;
      settleWait = (value) => {
        if (settled) return;
        settled = true;
        resolveWait(value);
      };
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url || "", "http://localhost:8085");
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("OAuth callback route not found.");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Google authentication failed: ${error}`);
        return;
      }

      if (code && state) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Google authentication completed. You can close this window.");
        settleWait?.({ code, state });
        return;
      }

      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing code or state query parameter.");
    });

    server.on("error", (error) => reject(error));
    server.listen(8085, CALLBACK_HOST, () => {
      resolve({
        server,
        cancelWait: () => settleWait?.(null),
        waitForCode: () => waitForCodePromise,
      });
    });
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getDefaultTier(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): { id?: string } {
  if (!allowedTiers || allowedTiers.length === 0) return { id: TIER_LEGACY };
  return allowedTiers.find((tier) => tier.isDefault) ?? { id: TIER_LEGACY };
}

function isVpcScAffectedUser(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (!("error" in payload)) return false;
  const error = (payload as GoogleRpcErrorResponse).error;
  if (!error?.details || !Array.isArray(error.details)) return false;
  return error.details.some((detail) => detail.reason === "SECURITY_POLICY_VIOLATED");
}

async function pollOperation(
  operationName: string,
  headers: Record<string, string>,
  onProgress?: (message: string) => void,
): Promise<LongRunningOperationResponse> {
  let attempt = 0;
  while (true) {
    if (attempt > 0) {
      onProgress?.(`Waiting for project provisioning (attempt ${attempt + 1})...`);
      await wait(5000);
    }

    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to poll operation: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as LongRunningOperationResponse;
    if (data.done) return data;
    attempt += 1;
  }
}

async function discoverProject(accessToken: string, onProgress?: (message: string) => void): Promise<string> {
  const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "GeminiCLI/0.35.3/gemini-3-pro-preview (linux; x64; terminal) google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
  };

  onProgress?.("Checking for existing Cloud Code Assist project...");
  const loadResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      cloudaicompanionProject: envProjectId,
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: envProjectId,
      },
    }),
  });

  let data: LoadCodeAssistPayload;
  if (!loadResponse.ok) {
    let errorPayload: unknown;
    try {
      errorPayload = await loadResponse.clone().json();
    } catch {
      errorPayload = undefined;
    }

    if (isVpcScAffectedUser(errorPayload)) {
      data = { currentTier: { id: TIER_STANDARD } };
    } else {
      const errorText = await loadResponse.text();
      throw new Error(`loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${errorText}`);
    }
  } else {
    data = (await loadResponse.json()) as LoadCodeAssistPayload;
  }

  if (data.currentTier) {
    if (data.cloudaicompanionProject) return data.cloudaicompanionProject;
    if (envProjectId) return envProjectId;
    throw new Error(
      "This account requires GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID. See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
    );
  }

  const tierId = getDefaultTier(data.allowedTiers).id ?? TIER_FREE;
  if (tierId !== TIER_FREE && !envProjectId) {
    throw new Error(
      "This account requires GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID. See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
    );
  }

  onProgress?.("Provisioning Cloud Code Assist project...");
  const onboardBody: Record<string, unknown> = {
    tierId,
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  };
  if (tierId !== TIER_FREE && envProjectId) {
    onboardBody.cloudaicompanionProject = envProjectId;
    (onboardBody.metadata as { duetProject?: string }).duetProject = envProjectId;
  }

  const onboardResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
    method: "POST",
    headers,
    body: JSON.stringify(onboardBody),
  });
  if (!onboardResponse.ok) {
    throw new Error(`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${await onboardResponse.text()}`);
  }

  let lroData = (await onboardResponse.json()) as LongRunningOperationResponse;
  if (!lroData.done && lroData.name) {
    lroData = await pollOperation(lroData.name, headers, onProgress);
  }

  const projectId = lroData.response?.cloudaicompanionProject?.id;
  if (projectId) return projectId;
  if (envProjectId) return envProjectId;
  throw new Error("Could not discover or provision a Cloud Code Assist project.");
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { email?: string };
    return payload.email;
  } catch {
    return undefined;
  }
}

export async function refreshGeminiCliToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const typedCredentials = credentials as GeminiCliCredentials;
  if (!typedCredentials.projectId) {
    throw new Error("Google Gemini CLI credentials are missing projectId.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: typedCredentials.refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  return {
    refresh: payload.refresh_token || typedCredentials.refresh,
    access: payload.access_token,
    expires: Date.now() + payload.expires_in * 1000 - 5 * 60 * 1000,
    projectId: typedCredentials.projectId,
    email: typedCredentials.email,
  };
}

export async function loginGeminiCli(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const { verifier, challenge } = await generatePKCE();
  callbacks.onProgress?.("Starting local OAuth callback server...");
  const callbackServer = await startCallbackServer();

  try {
    const authParams = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
      access_type: "offline",
      prompt: "consent",
    });
    callbacks.onAuth({
      url: `${AUTH_URL}?${authParams.toString()}`,
      instructions: "Complete Google sign-in in your browser.",
    });

    let code: string | undefined;
    if (callbacks.onManualCodeInput) {
      let manualInput: string | undefined;
      let manualError: Error | undefined;
      const manualPromise = callbacks
        .onManualCodeInput()
        .then((input) => {
          manualInput = input;
          callbackServer.cancelWait();
        })
        .catch((error: unknown) => {
          manualError = error instanceof Error ? error : new Error(String(error));
          callbackServer.cancelWait();
        });

      const callbackResult = await callbackServer.waitForCode();
      if (manualError) throw manualError;

      if (callbackResult?.code) {
        if (callbackResult.state !== verifier) {
          throw new Error("OAuth state mismatch.");
        }
        code = callbackResult.code;
      } else if (manualInput) {
        const parsed = parseRedirectUrl(manualInput);
        if (parsed.state && parsed.state !== verifier) {
          throw new Error("OAuth state mismatch.");
        }
        code = parsed.code;
      }

      if (!code) {
        await manualPromise;
        if (manualError) throw manualError;
        if (manualInput) {
          const parsed = parseRedirectUrl(manualInput);
          if (parsed.state && parsed.state !== verifier) {
            throw new Error("OAuth state mismatch.");
          }
          code = parsed.code;
        }
      }
    } else {
      const callbackResult = await callbackServer.waitForCode();
      if (callbackResult?.code) {
        if (callbackResult.state !== verifier) {
          throw new Error("OAuth state mismatch.");
        }
        code = callbackResult.code;
      }
    }

    if (!code) {
      throw new Error("No authorization code received.");
    }

    callbacks.onProgress?.("Exchanging authorization code...");
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    if (!tokenPayload.refresh_token) {
      throw new Error("No refresh token received from Google OAuth.");
    }

    callbacks.onProgress?.("Discovering Cloud Code Assist project...");
    const [email, projectId] = await Promise.all([
      getUserEmail(tokenPayload.access_token),
      discoverProject(tokenPayload.access_token, callbacks.onProgress),
    ]);

    return {
      refresh: tokenPayload.refresh_token,
      access: tokenPayload.access_token,
      expires: Date.now() + tokenPayload.expires_in * 1000 - 5 * 60 * 1000,
      projectId,
      email,
    };
  } finally {
    callbackServer.server.close();
  }
}

export const geminiCliOAuthConfig: ProviderConfig["oauth"] = {
  name: "Google Gemini CLI",
  login: loginGeminiCli,
  refreshToken: refreshGeminiCliToken,
  getApiKey: (credentials) => {
    const typedCredentials = credentials as GeminiCliCredentials;
    if (!typedCredentials.access || !typedCredentials.projectId) {
      throw new Error("Google Gemini CLI credentials are incomplete. Run /login google-gemini-cli.");
    }
    return JSON.stringify({ token: typedCredentials.access, projectId: typedCredentials.projectId });
  },
};
