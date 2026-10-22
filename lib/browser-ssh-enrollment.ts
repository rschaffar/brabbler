import { createHash, createPublicKey } from "node:crypto";
import { decodeBase64url, webAuthnOrigin, type BrowserSshCredential } from "./browser-ssh-protocol";

/** Original browser bytes, not decoded/re-serialized JSON or client-derived flags. */
export type BrowserSshRegistration = {
  clientDataJSON: string;
  authenticatorData: string;
  id: string;
  spki: string;
  algorithm: -7;
  /** From getClientExtensionResults().credProps?.rk; never infer from residentKey. */
  discoverable?: boolean;
};

const MAX_REGISTRATION_DATA = 4096;
const MAX_CBOR_ITEMS = 256;
const MAX_CBOR_DEPTH = 8;
const MAX_CBOR_COLLECTION = 64;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type Cbor = number | string | Buffer | boolean | null | Cbor[] | Map<number | string, Cbor>;

/**
 * Deliberately limited CBOR, not a general-purpose decoder. Definite-length
 * integers (up to 32 bits), strings, arrays, maps, booleans and null only.
 * Reject tags, floats, indefinite lengths, complex keys and duplicate map keys.
 * All reads share item/depth/byte budgets, including ignored extension values.
 */
class RegistrationReader {
  private offset = 0;
  private items = 0;
  constructor(private readonly data: Buffer) {}
  take(size: number): Buffer {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.data.length - this.offset) throw new Error("Truncated registration data");
    const result = this.data.subarray(this.offset, this.offset + size);
    this.offset += size;
    return result;
  }
  byte(): number { return this.take(1)[0]; }
  uint16(): number { return this.take(2).readUInt16BE(); }
  private argument(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.byte();
    if (additional === 25) return this.uint16();
    if (additional === 26) return this.take(4).readUInt32BE();
    throw new Error("Unsupported CBOR length or integer");
  }
  cbor(depth = 0): Cbor {
    if (depth > MAX_CBOR_DEPTH || ++this.items > MAX_CBOR_ITEMS) throw new Error("Registration CBOR limit exceeded");
    const initial = this.byte(), major = initial >>> 5, additional = initial & 31;
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      throw new Error("Unsupported CBOR simple value");
    }
    if (major > 5) throw new Error("Unsupported CBOR type");
    const argument = this.argument(additional);
    if (major === 0) return argument;
    if (major === 1) return -1 - argument;
    if (major === 2) return this.take(argument);
    if (major === 3) return utf8.decode(this.take(argument));
    if (argument > MAX_CBOR_COLLECTION) throw new Error("Registration CBOR collection too large");
    if (major === 4) {
      const values: Cbor[] = [];
      for (let i = 0; i < argument; i++) values.push(this.cbor(depth + 1));
      return values;
    }
    const values = new Map<number | string, Cbor>();
    for (let i = 0; i < argument; i++) {
      const key = this.cbor(depth + 1);
      if (typeof key !== "number" && typeof key !== "string") throw new Error("Unsupported CBOR map key");
      if (values.has(key)) throw new Error("Duplicate CBOR map key");
      values.set(key, this.cbor(depth + 1));
    }
    return values;
  }
  end(): void { if (this.offset !== this.data.length) throw new Error("Unexpected registration data"); }
}

/**
 * Validate registration structure and ceremony binding, NOT attestation or key
 * possession. With attestation:none these authenticator-data bytes, including
 * credProtect, are not signature-verified by this function. Protection is only
 * the reported authenticator-data extension value; discoverability is a client
 * report. Neither is hardware provenance or signing/unlock authority.
 *
 * Caller owns authenticated same-origin admission, challenge issuance, bounded
 * lifetime and atomic one-time consumption. Require fresh UP+UV assertion proof
 * of possession before activating/publishing this credential. Never persist an
 * unlock grant based on this result.
 */
export function verifyBrowserRegistration(
  registration: BrowserSshRegistration,
  expected: { challenge: Buffer; origin: string },
): { credential: BrowserSshCredential; protection: 1 | 2 | 3 | null; discoverability: "resident" | "non-resident" | "unknown" } {
  if (!Buffer.isBuffer(expected.challenge) || expected.challenge.length < 32 || expected.challenge.length > 1024) throw new Error("Invalid registration challenge");
  const { origin, rpId } = webAuthnOrigin(expected.origin);
  if (!registration || typeof registration !== "object" || Array.isArray(registration) || registration.algorithm !== -7
    || (registration.discoverable !== undefined && typeof registration.discoverable !== "boolean")) throw new Error("Invalid browser registration");
  const id = decodeBase64url(registration.id, 1024);
  const spki = decodeBase64url(registration.spki, 256);
  const clientData = decodeBase64url(registration.clientDataJSON, MAX_REGISTRATION_DATA);
  const client: unknown = JSON.parse(utf8.decode(clientData));
  if (!client || typeof client !== "object" || Array.isArray(client)) throw new Error("Invalid registration client data");
  const ceremony = client as Record<string, unknown>;
  if (ceremony.type !== "webauthn.create" || ceremony.challenge !== expected.challenge.toString("base64url") || ceremony.origin !== origin
    || (ceremony.crossOrigin !== undefined && ceremony.crossOrigin !== false) || ceremony.topOrigin !== undefined) throw new Error("WebAuthn registration does not match this request");

  const authData = decodeBase64url(registration.authenticatorData, MAX_REGISTRATION_DATA);
  const reader = new RegistrationReader(authData);
  if (!reader.take(32).equals(createHash("sha256").update(rpId).digest())) throw new Error("Wrong registration RP hash");
  const flags = reader.byte();
  // UP + UV + AT mandatory; reserved bits clear; BS implies BE. ED is optional.
  if ((flags & 0x45) !== 0x45 || (flags & 0x22) !== 0 || ((flags & 0x10) !== 0 && (flags & 0x08) === 0)) throw new Error("Invalid registration flags or missing user verification");
  reader.take(4); // signCount is not a hardware claim or grant.
  reader.take(16); // AAGUID without verified attestation is not provenance.
  const idLength = reader.uint16();
  if (!idLength || idLength > 1024 || !reader.take(idLength).equals(id)) throw new Error("Registration credential ID mismatch");

  const cose = reader.cbor();
  if (!(cose instanceof Map) || cose.size !== 5 || cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) throw new Error("Unsupported registration COSE key");
  const x = cose.get(-2), y = cose.get(-3);
  if (!Buffer.isBuffer(x) || x.length !== 32 || !Buffer.isBuffer(y) || y.length !== 32) throw new Error("Invalid registration P-256 point");
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  const jwk = key.export({ format: "jwk" });
  if (!key.export({ format: "der", type: "spki" }).equals(spki) || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y
    || !decodeBase64url(jwk.x, 32).equals(x) || !decodeBase64url(jwk.y, 32).equals(y)) throw new Error("Registration COSE/SPKI key mismatch");

  let protection: 1 | 2 | 3 | null = null;
  if (flags & 0x80) {
    const extensions = reader.cbor();
    if (!(extensions instanceof Map) || [...extensions.keys()].some((name) => typeof name !== "string")) throw new Error("Invalid registration extensions");
    if (extensions.has("credProtect")) {
      const value = extensions.get("credProtect");
      if (value !== 1 && value !== 2 && value !== 3) throw new Error("Invalid credential protection report");
      protection = value;
    }
  }
  reader.end();
  return {
    credential: { id: registration.id, spki: registration.spki },
    protection,
    discoverability: registration.discoverable === undefined ? "unknown" : registration.discoverable ? "resident" : "non-resident",
  };
}
