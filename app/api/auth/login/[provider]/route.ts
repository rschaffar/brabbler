import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { invalidateModelsCache } from "@/lib/models-cache";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { accountCredentialStore, listProviderAccounts } from "@/lib/provider-accounts";
import { createSseStream, SSE_HEADERS } from "@/lib/sse-stream";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<uuid>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (req.signal.aborted) return new Response(null, { status: 204 });

  // Disconnects cancel provider work and settle pending client input, even
  // when initialization has not finished yet.
  const abort = new AbortController();
  const registry = getCallbackRegistry();
  const activeTokens = new Set<string>();
  const cleanup = () => {
    abort.abort();
    for (const token of activeTokens) {
      registry.get(token)?.reject(new Error("Login cancelled"));
      registry.delete(token);
    }
    activeTokens.clear();
  };

  const stream = createSseStream(
    req,
    async (writer) => {
      const send = (data: unknown) => writer.send(data);
      let modelRuntime;
      try {
        const accountId = new URL(req.url).searchParams.get("accountId");
        const account = accountId ? listProviderAccounts().find((item) => item.id === accountId) : undefined;
        if (accountId && (!account || account.provider !== provider || account.type !== "oauth")) {
          send({ type: "error", message: "OAuth account not found for provider" });
          writer.close();
          return;
        }
        modelRuntime = await createModelRuntimeWithExtensions(
          account ? accountCredentialStore({ [provider]: account.id }, undefined, undefined, { allowPendingLogin: true }) : undefined,
        );
        if (writer.closed) return;
        if (!modelRuntime.getProvider(provider)?.auth.oauth) {
          send({ type: "error", message: `Unknown provider: ${provider}` });
          writer.close();
          return;
        }
      } catch {
        send({ type: "error", message: "Could not initialize provider authorization" });
        writer.close();
        return;
      }

      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        if (writer.closed || abort.signal.aborted) throw new Error("Login cancelled");
        // Manual-code handshake token; crypto randomness so a pending OAuth
        // manual flow cannot be hijacked by predicting Math.random().
        const token = `${provider}-${randomUUID()}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        // A provider may still be awaiting other work when cancellation
        // rejects this input. Keep rejection handled until it awaits the code.
        void promise.catch(() => {});
        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      try {
        await modelRuntime.login(provider, "oauth", {
          prompt: async (prompt: AuthPrompt) => {
            const request = prompt.type === "manual_code"
              ? getManualInputRequest()
              : createClientInputRequest();
            if (prompt.type === "select") {
              send({
                type: "select_request",
                message: prompt.message,
                options: prompt.options,
                token: request.token,
              });
            } else {
              send({
                type: "prompt_request",
                message: prompt.message,
                placeholder: prompt.placeholder ?? null,
                token: request.token,
              });
            }
            return request.promise;
          },
          notify: (event: AuthEvent) => {
            if (writer.closed) return;
            if (event.type === "auth_url") {
              const request = getManualInputRequest();
              send({
                type: "auth",
                url: event.url,
                instructions: event.instructions ?? null,
                token: request.token,
              });
            } else if (event.type === "device_code") {
              send({
                type: "device_code",
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                intervalSeconds: event.intervalSeconds ?? null,
                expiresInSeconds: event.expiresInSeconds ?? null,
              });
            } else {
              send({ type: "progress", message: event.message });
            }
          },
          signal: abort.signal,
        });

        if (writer.closed) return;
        invalidateModelsCache();
        send({ type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send({ type: "error", message: msg });
        } else {
          send({ type: "cancelled" });
        }
      } finally {
        writer.close();
      }
    },
    cleanup,
  );

  return new Response(stream, { headers: SSE_HEADERS });
}
