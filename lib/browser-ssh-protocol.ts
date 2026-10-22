import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export const SSH_SK_TYPE = "sk-ecdsa-sha2-nistp256@openssh.com";
const WEB_AUTHN_TYPE = "webauthn-sk-ecdsa-sha2-nistp256@openssh.com";
export const MAX_SSH_FRAME = 32 * 1024;
export type BrowserSshCredential = { id: string; spki: string };
export type BrowserSshAssertion = { id: string; clientData: string; authenticatorData: string; signature: string };
export type SshIdentity = { credential: BrowserSshCredential; key: KeyObject; blob: Buffer; publicKey: string; rpId: string; origin: string };

export function decodeBase64url(value: unknown, max = MAX_SSH_FRAME): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url data");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length > max || decoded.toString("base64url") !== value) throw new Error("Invalid base64url data");
  return decoded;
}

export function sshString(value: Buffer | string): Buffer {
  const data = typeof value === "string" ? Buffer.from(value) : value;
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  return Buffer.concat([size, data]);
}

export class SshReader {
  private offset = 0;
  constructor(private readonly data: Buffer) {}
  byte(): number {
    if (this.offset >= this.data.length) throw new Error("Truncated SSH data");
    return this.data[this.offset++];
  }
  uint32(): number {
    if (this.offset + 4 > this.data.length) throw new Error("Truncated SSH data");
    const value = this.data.readUInt32BE(this.offset); this.offset += 4; return value;
  }
  string(): Buffer {
    const length = this.uint32();
    if (length > MAX_SSH_FRAME || length > this.data.length - this.offset) throw new Error("Invalid SSH string length");
    const value = this.data.subarray(this.offset, this.offset + length); this.offset += length; return value;
  }
  end(): void { if (this.offset !== this.data.length) throw new Error("Unexpected SSH data"); }
}

export function webAuthnOrigin(value: string): { origin: string; rpId: string } {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.hostname.length > 253
    || !/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname.endsWith(".")
    || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
    || /^\d+(\.\d+){3}$/.test(url.hostname)) throw new Error("Browser SSH requires HTTPS with a DNS hostname (or http://localhost)");
  return { origin: url.origin, rpId: url.hostname };
}

export function sshIdentity(credential: BrowserSshCredential, originValue: string): SshIdentity {
  decodeBase64url(credential.id, 1024);
  const key = createPublicKey({ key: decodeBase64url(credential.spki, 256), format: "der", type: "spki" });
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("Only ES256/P-256 credentials are supported");
  const { origin, rpId } = webAuthnOrigin(originValue);
  const point = Buffer.concat([Buffer.from([4]), decodeBase64url(jwk.x, 32), decodeBase64url(jwk.y, 32)]);
  if (point.length !== 65) throw new Error("Invalid P-256 point");
  const blob = Buffer.concat([sshString(SSH_SK_TYPE), sshString("nistp256"), sshString(point), sshString(rpId)]);
  return { credential: { id: credential.id, spki: credential.spki }, key, blob, publicKey: `${SSH_SK_TYPE} ${blob.toString("base64")} pi-web-browser`, rpId, origin };
}

const hash = (data: Buffer | string) => createHash("sha256").update(data).digest();

/** Parse DER strictly; SSH uses positive, canonical mpints rather than ASN.1. */
function ecdsaMpints(der: Buffer): Buffer {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("Invalid ES256 signature");
  let offset = 2;
  const integer = () => {
    if (der[offset++] !== 2) throw new Error("Invalid ECDSA integer");
    const length = der[offset++];
    const value = der.subarray(offset, offset + length); offset += length;
    if (!length || length > 33 || value.length !== length || (value[0] & 0x80)
      || (value[0] === 0 && (length === 1 || !(value[1] & 0x80)))) throw new Error("Invalid ECDSA integer");
    return sshString(value);
  };
  const result = Buffer.concat([integer(), integer()]);
  if (offset !== der.length) throw new Error("Unexpected ECDSA data");
  return result;
}

/** Verify original browser bytes; never reserialize clientDataJSON. */
export function verifyBrowserAssertion(identity: SshIdentity, challenge: Buffer, assertion: BrowserSshAssertion, options: { requireUV?: boolean } = {}): Buffer {
  if (assertion.id !== identity.credential.id) throw new Error("Wrong browser credential");
  const clientData = decodeBase64url(assertion.clientData, 4096);
  const authData = decodeBase64url(assertion.authenticatorData, 37);
  const signature = decodeBase64url(assertion.signature, 72);
  const client = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clientData));
  const expectedPrefix = `{"type":"webauthn.get","challenge":${JSON.stringify(challenge.toString("base64url"))},"origin":${JSON.stringify(identity.origin)}`;
  if (client?.type !== "webauthn.get" || client.challenge !== challenge.toString("base64url") || client.origin !== identity.origin
    || (client.crossOrigin !== undefined && client.crossOrigin !== false) || client.topOrigin !== undefined
    || !clientData.toString("utf8").startsWith(expectedPrefix)) throw new Error("WebAuthn ceremony does not match this request");
  // Only the server policy layer may relax UV under an exact live grant. UP is
  // unconditional; AT/ED/reserved flags remain forbidden. Default stays strict.
  const required = options.requireUV === false ? 0x01 : 0x05;
  if (authData.length !== 37 || !authData.subarray(0, 32).equals(hash(identity.rpId))
    || (authData[32] & required) !== required || (authData[32] & 0xe2) !== 0
    || ((authData[32] & 0x10) && !(authData[32] & 0x08))) throw new Error("Invalid WebAuthn authenticator data or missing user verification");
  if (!verify("sha256", Buffer.concat([authData, hash(clientData)]), identity.key, signature)) throw new Error("Invalid WebAuthn signature");
  return Buffer.concat([
    sshString(WEB_AUTHN_TYPE), sshString(ecdsaMpints(signature)), authData.subarray(32, 37),
    sshString(identity.origin), sshString(clientData), sshString(Buffer.alloc(0)),
  ]);
}

/** OpenSSH-style web-safe filter: never turn this into an arbitrary WebAuthn oracle. */
export function describeSshPayload(data: Buffer, identity: SshIdentity): string {
  // Leaves room for the base64url challenge, origin and browser-added JSON
  // members within the 4 KiB clientData limit (and the 16 KiB HTTP body).
  if (data.length > 2048) throw new Error("Signing data is too large");
  if (data.subarray(0, 6).equals(Buffer.from("SSHSIG"))) {
    const reader = new SshReader(data.subarray(6));
    const namespace = reader.string().toString("utf8");
    const reserved = reader.string();
    const algorithm = reader.string().toString("utf8");
    const digest = reader.string(); reader.end();
    if (!/^[a-zA-Z0-9@._-]{1,100}$/.test(namespace) || reserved.length || !["sha256", "sha512"].includes(algorithm)
      || digest.length !== (algorithm === "sha256" ? 32 : 64)) throw new Error("Invalid SSHSIG payload");
    return `SSHSIG namespace: ${namespace}`;
  }
  const reader = new SshReader(data);
  const session = reader.string();
  if (![32, 48, 64].includes(session.length) || reader.byte() !== 50) throw new Error("Only SSH authentication and SSHSIG requests are supported");
  const user = reader.string().toString("utf8");
  const service = reader.string().toString("utf8");
  const method = reader.string().toString("utf8");
  if (!/^[\x21-\x7e]{1,128}$/.test(user) || service !== "ssh-connection"
    || !["publickey", "publickey-hostbound-v00@openssh.com"].includes(method)
    || reader.byte() !== 1 || reader.string().toString("utf8") !== SSH_SK_TYPE || !reader.string().equals(identity.blob)) throw new Error("Invalid SSH authentication payload");
  if (method !== "publickey") reader.string(); // Unverified host key: NOT destination attestation.
  reader.end();
  return `SSH authentication user: ${user}`;
}

export function payloadFingerprint(data: Buffer): string { return `SHA256:${hash(data).toString("base64url")}`; }
