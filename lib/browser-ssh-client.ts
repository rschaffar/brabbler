import type { BrowserSshAssertion, BrowserSshCredential } from "./browser-ssh-protocol";

export const BROWSER_SSH_STORAGE_KEY = "pi-web:browser-ssh-credential:v1";
export function encodeBrowserBytes(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeBrowserBytes(value: string): Uint8Array<ArrayBuffer> {
  if (value.length > 32768 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid credential data");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
}
export async function browserSshApi<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/ssh-agent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}
export async function enrollBrowserSshCredential(signal: AbortSignal): Promise<BrowserSshCredential> {
  const result = await navigator.credentials.create({ signal, publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { id: location.hostname, name: "Pi Web SSH" },
    user: { id: crypto.getRandomValues(new Uint8Array(32)), name: "pi-web-ssh", displayName: "Pi Web SSH" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "discouraged", userVerification: "required" },
    attestation: "none", timeout: 60_000,
  } }) as PublicKeyCredential | null;
  const response = result?.response as AuthenticatorAttestationResponse | undefined;
  const spki = response?.getPublicKey?.();
  if (!result || !spki || response?.getPublicKeyAlgorithm?.() !== -7) throw new Error("This browser or authenticator does not expose an ES256 credential");
  return { id: encodeBrowserBytes(result.rawId), spki: encodeBrowserBytes(spki) };
}
export async function requestBrowserSshAssertion(credential: BrowserSshCredential, challenge: string, signal: AbortSignal): Promise<BrowserSshAssertion> {
  const result = await navigator.credentials.get({ signal, publicKey: {
    rpId: location.hostname, challenge: decodeBrowserBytes(challenge),
    allowCredentials: [{ type: "public-key", id: decodeBrowserBytes(credential.id), transports: ["usb", "nfc", "ble"] }],
    userVerification: "required", timeout: 60_000,
  } }) as PublicKeyCredential | null;
  if (!result) throw new Error("No browser credential returned");
  const response = result.response as AuthenticatorAssertionResponse;
  return { id: encodeBrowserBytes(result.rawId), clientData: encodeBrowserBytes(response.clientDataJSON), authenticatorData: encodeBrowserBytes(response.authenticatorData), signature: encodeBrowserBytes(response.signature) };
}
