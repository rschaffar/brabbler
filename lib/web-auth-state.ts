import { createHash, randomBytes } from "node:crypto";
import { readCredentials, verifyPassword } from "../bin/web-auth-store.js";
import { isValidWebPassword } from "./web-auth";

type Credentials = NonNullable<ReturnType<typeof readCredentials>>;
export type WebAuthState =
  | { mode: "disabled" | "locked" }
  | { mode: "environment"; password: string; signingKey: string }
  | { mode: "stored"; credentials: Credentials; signingKey: string };
const envKeySymbol = Symbol.for("brabbler:environment-auth-signing-key");
const globals = globalThis as typeof globalThis & { [envKeySymbol]?: { digest: string; key: string } };

/** Read fresh on each admission, so deletion, corruption and rotation revoke immediately. */
export function getWebAuthState(): WebAuthState {
  const required = process.env.BRABBLER_REQUIRE_AUTH;
  // Unknown/non-canonical flag values lock instead of silently turning protection off.
  if (required !== undefined && !["", "0", "1"].includes(required)) return { mode: "locked" };
  try {
    const credentials = readCredentials();
    const password = process.env.BRABBLER_PASSWORD;
    if (credentials && password) return { mode: "locked" };
    if (credentials) return { mode: "stored", credentials, signingKey: credentials.key };
    if (password) {
      const digest = createHash("sha256").update(password).digest("hex");
      if (globals[envKeySymbol]?.digest !== digest) globals[envKeySymbol] = { digest, key: randomBytes(32).toString("hex") };
      return { mode: "environment", password, signingKey: globals[envKeySymbol]!.key };
    }
    return { mode: required === "1" ? "locked" : "disabled" };
  } catch { return { mode: "locked" }; }
}
export function signingKey(state = getWebAuthState()): string | undefined {
  return "signingKey" in state ? state.signingKey : undefined;
}
export async function verifyWebPassword(password: string, state: WebAuthState): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > 1024) return false;
  if (state.mode === "environment") return isValidWebPassword(password, state.password);
  if (state.mode !== "stored") return false;
  return verifyPassword(password, state.credentials);
}
export async function verifyBasicAuthorization(header: string | null, state: WebAuthState): Promise<boolean> {
  if (!header || header.length > 2048) return false;
  const match = /^Basic\s+(\S+)$/i.exec(header);
  if (!match) return false;
  try {
    const bytes = Buffer.from(match[1], "base64");
    if (bytes.toString("base64") !== match[1]) return false;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!decoded.startsWith("pi:")) return false;
    return await verifyWebPassword(decoded.slice(3), state);
  } catch (error) {
    if (isAuthBusy(error)) throw error;
    return false;
  }
}
export function isAuthBusy(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "AUTH_BUSY";
}
