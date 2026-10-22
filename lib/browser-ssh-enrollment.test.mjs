import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";
const { verifyBrowserRegistration } = await createJiti(import.meta.url).import("./browser-ssh-enrollment.ts");

const b64 = value => Buffer.from(value).toString("base64url");
function head(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length <= 255) return Buffer.from([(major << 5) | 24, length]);
  const bytes = Buffer.alloc(length <= 65535 ? 3 : 5);
  bytes[0] = (major << 5) | (length <= 65535 ? 25 : 26);
  if (length <= 65535) bytes.writeUInt16BE(length, 1); else bytes.writeUInt32BE(length, 1);
  return bytes;
}
function cbor(value) {
  if (value === null) return Buffer.from([0xf6]);
  if (value === true || value === false) return Buffer.from([value ? 0xf5 : 0xf4]);
  if (typeof value === "number") return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(typeof value === "string" ? 3 : 2, bytes.length), bytes]);
  }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) return mapEntries([...value]);
  throw new Error("Unsupported test CBOR value");
}
function mapEntries(entries) {
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, value]) => [cbor(key), cbor(value)])]);
}
function fixture(origin = "https://ssh.example.test:3443") {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = Buffer.from("synthetic-enrollment-id");
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
  const expected = { origin, challenge: Buffer.alloc(32, 0x73) };
  const client = { type: "webauthn.create", challenge: b64(expected.challenge), origin, crossOrigin: false };
  const registration = { id: b64(id), spki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"), algorithm: -7, clientDataJSON: b64(JSON.stringify(client)) };
  function auth(options = {}) {
    const flags = options.flags ?? (options.extensions !== undefined ? 0xc5 : 0x45);
    const credentialId = options.id ?? id;
    const length = Buffer.alloc(2); length.writeUInt16BE(options.idLength ?? credentialId.length);
    return Buffer.concat([
      options.rpHash ?? createHash("sha256").update(new URL(origin).hostname).digest(),
      Buffer.from([flags]), options.counter ?? Buffer.alloc(4), options.aaguid ?? Buffer.alloc(16),
      length, credentialId, options.cose ?? cbor(cose), options.extensions ?? Buffer.alloc(0), options.trailing ?? Buffer.alloc(0),
    ]);
  }
  registration.authenticatorData = b64(auth());
  return { expected, registration, client, id, cose, auth };
}
const verify = (f, changes = {}) => verifyBrowserRegistration({ ...f.registration, ...changes }, f.expected);
const verifyAuth = (f, options) => verify(f, { authenticatorData: b64(f.auth(options)) });

test("validates original creation data and returns only public credential metadata", () => {
  const f = fixture();
  assert.deepEqual(verify(f), {
    credential: { id: f.registration.id, spki: f.registration.spki }, protection: null, discoverability: "unknown",
  });
  // Ordinary JSON whitespace/member ordering and extra browser members are valid.
  const reordered = { origin: f.client.origin, crossOrigin: false, challenge: f.client.challenge, type: f.client.type, extra: "browser metadata" };
  assert.equal(verify(f, { clientDataJSON: b64(JSON.stringify(reordered, null, 2)) }).protection, null);
  const withoutCrossOrigin = { ...f.client }; delete withoutCrossOrigin.crossOrigin;
  assert.equal(verify(f, { clientDataJSON: b64(JSON.stringify(withoutCrossOrigin)) }).protection, null);
});

test("returns protection exclusively from authenticator-data ED map; absence stays unknown", () => {
  const f = fixture();
  for (const protection of [1, 2, 3]) {
    const result = verifyAuth(f, { extensions: cbor(new Map([["credProtect", protection]])) });
    assert.equal(result.protection, protection);
  }
  assert.equal(verifyAuth(f, { extensions: cbor(new Map()) }).protection, null);
  assert.equal(verifyAuth(f, { extensions: cbor(new Map([["other", true]])) }).protection, null);
  assert.equal(verify(f, { protection: 3, credProtect: 3, clientExtensionResults: { credProtect: 3 } }).protection, null);
  for (const value of [0, 4, -1, "3", true, null, Buffer.from([3]), [3], new Map()]) {
    assert.throws(() => verifyAuth(f, { extensions: cbor(new Map([["credProtect", value]])) }));
  }
  // In particular, the API performs NO attestation/signature proof: callers must
  // obtain fresh UV assertion proof before activating this synthetic registration.
});

test("discoverability is an explicit client report, never inferred from flags or protection", () => {
  const f = fixture();
  assert.equal(verify(f, { discoverable: true }).discoverability, "resident");
  assert.equal(verify(f, { discoverable: false }).discoverability, "non-resident");
  assert.equal(verify(f).discoverability, "unknown");
  assert.equal(verifyAuth(f, { flags: 0x5d }).discoverability, "unknown");
  for (const discoverable of [null, "false", 0, 1, {}, []]) assert.throws(() => verify(f, { discoverable }));
});

test("binds exact creation type, challenge, origin and top-level ceremony", () => {
  const f = fixture();
  for (const changes of [
    { type: "webauthn.get" }, { type: null }, { challenge: "wrong" }, { challenge: `${f.client.challenge}=` },
    { origin: "https://ssh.example.test" }, { origin: "https://other.example.test:3443" }, { origin: `${f.expected.origin}/` },
    { crossOrigin: true }, { crossOrigin: null }, { crossOrigin: 0 }, { topOrigin: f.expected.origin }, { topOrigin: null },
  ]) assert.throws(() => verify(f, { clientDataJSON: b64(JSON.stringify({ ...f.client, ...changes })) }), undefined, JSON.stringify(changes));
  for (const value of [null, [], "text", 42]) assert.throws(() => verify(f, { clientDataJSON: b64(JSON.stringify(value)) }));
  for (const property of ["type", "challenge", "origin"]) {
    const client = { ...f.client }; delete client[property];
    assert.throws(() => verify(f, { clientDataJSON: b64(JSON.stringify(client)) }));
  }
  assert.throws(() => verify(f, { clientDataJSON: b64("{") }));
  assert.throws(() => verify(f, { clientDataJSON: b64(Buffer.from([0xff])) }));
  assert.throws(() => verify(f, { clientDataJSON: b64(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(f.client))])) }));
  assert.throws(() => verify(f, { clientDataJSON: b64(" ".repeat(4097)) }));
});

test("enforces valid expected origin and bounded server challenges", () => {
  const f = fixture();
  for (const origin of ["http://remote.example.test", "https://127.0.0.1", `${f.expected.origin}/`, "https://ssh.example.test.", "https://user@ssh.example.test"]) {
    assert.throws(() => verifyBrowserRegistration(f.registration, { ...f.expected, origin }));
  }
  for (const challenge of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(1025), "not-a-buffer"]) {
    assert.throws(() => verifyBrowserRegistration(f.registration, { ...f.expected, challenge }));
  }
  const local = fixture("http://localhost:30141");
  assert.equal(verify(local).protection, null);
});

test("validates RP hash and exhaustively checks UP/UV/AT, reserved and backup flags", () => {
  const f = fixture();
  assert.throws(() => verifyAuth(f, { rpHash: Buffer.alloc(32) }));
  for (let flags = 0; flags <= 255; flags++) {
    const options = { flags, extensions: flags & 0x80 ? cbor(new Map()) : Buffer.alloc(0) };
    const valid = (flags & 0x45) === 0x45 && (flags & 0x22) === 0 && (!(flags & 0x10) || (flags & 0x08));
    if (valid) assert.equal(verifyAuth(f, options).protection, null);
    else assert.throws(() => verifyAuth(f, options), undefined, `flags=${flags}`);
  }
  assert.equal(verifyAuth(f, { counter: Buffer.from([255, 255, 255, 255]), aaguid: Buffer.alloc(16, 255) }).protection, null);
});

test("requires exact nonempty bounded credential ID and complete binary consumption", () => {
  const f = fixture();
  assert.throws(() => verify(f, { id: b64("different-id") }));
  assert.throws(() => verifyAuth(f, { id: Buffer.alloc(0) }));
  assert.throws(() => verifyAuth(f, { id: Buffer.alloc(1025) }));
  assert.throws(() => verifyAuth(f, { idLength: 1024 }));
  assert.throws(() => verifyAuth(f, { trailing: Buffer.from([0]) }));
  assert.throws(() => verifyAuth(f, { flags: 0x45, extensions: cbor(new Map([["credProtect", 3]])) }));
  assert.throws(() => verifyAuth(f, { flags: 0xc5 }));
  const bytes = f.auth({ extensions: cbor(new Map([["credProtect", 3]])) });
  for (let length = 0; length < bytes.length; length++) {
    assert.throws(() => verify(f, { authenticatorData: b64(bytes.subarray(0, length)) }), undefined, `truncated at ${length}`);
  }
  assert.throws(() => verify(f, { authenticatorData: b64(Buffer.alloc(4097)) }));
});

test("requires ES256 P-256 public COSE key, correct coordinates and matching canonical SPKI", () => {
  const f = fixture();
  for (const [label, value] of [[1, 3], [3, -8], [-1, 2], [-2, Buffer.alloc(31)], [-3, Buffer.alloc(33)], [-2, "not bytes"], [-3, Buffer.alloc(32)]]) {
    const cose = new Map(f.cose); cose.set(label, value);
    assert.throws(() => verifyAuth(f, { cose: cbor(cose) }));
  }
  for (const label of f.cose.keys()) {
    const cose = new Map(f.cose); cose.delete(label);
    assert.throws(() => verifyAuth(f, { cose: cbor(cose) }));
  }
  // Deliberate supported subset: exactly the five public ES256 labels.
  for (const label of [-4, 2, 4]) {
    const cose = new Map(f.cose); cose.set(label, Buffer.alloc(32));
    assert.throws(() => verifyAuth(f, { cose: cbor(cose) }));
  }
  const other = fixture();
  assert.throws(() => verify(f, { spki: other.registration.spki }));
  assert.throws(() => verify(f, { spki: b64(Buffer.concat([Buffer.from(f.registration.spki, "base64url"), Buffer.from([0])])) }));
  const ed = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" });
  const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey.export({ type: "spki", format: "der" });
  for (const key of [ed, p384, Buffer.alloc(10)]) assert.throws(() => verify(f, { spki: b64(key) }));
  for (const algorithm of [-8, 0, "-7", null, undefined]) assert.throws(() => verify(f, { algorithm }));
});

test("rejects duplicate CBOR keys including differently encoded numeric keys", () => {
  const f = fixture();
  assert.throws(() => verifyAuth(f, { cose: mapEntries([...f.cose, [1, 2]]) }), /Duplicate/);
  assert.throws(() => verifyAuth(f, { extensions: mapEntries([["credProtect", 1], ["credProtect", 3]]) }), /Duplicate/);
  const nested = Buffer.concat([head(5, 1), cbor("ignored"), mapEntries([["x", 1], ["x", 2]])]);
  assert.throws(() => verifyAuth(f, { extensions: nested }), /Duplicate/);
  // a2 01 02 18 01 02 encodes two identical integer keys using different widths.
  assert.throws(() => verifyAuth(f, { cose: Buffer.from([0xa2, 0x01, 0x02, 0x18, 0x01, 0x02]) }), /Duplicate/);
});

test("rejects malformed or unsupported CBOR without unbounded traversal", () => {
  const f = fixture();
  const invalid = [
    Buffer.from([0xbf, 0xff]), // indefinite map
    Buffer.from([0x9f, 0xff]), // indefinite array
    Buffer.from([0x5f, 0xff]), // indefinite bytes
    Buffer.from([0xc0, 0xa0]), // tag
    Buffer.from([0xfa, 0, 0, 0, 0]), // float
    Buffer.from([0xf7]), // undefined
    Buffer.from([0xff]), // break
    Buffer.from([0x1c]), // reserved additional info
    Buffer.from([0x1b, 0, 0, 0, 0, 0, 0, 0, 1]), // unsupported 64-bit integer
    Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff]), // huge byte length
    Buffer.from([0x7a, 0xff, 0xff, 0xff, 0xff]), // huge text length
    Buffer.from([0xa1, 0x61, 0xff, 0x01]), // invalid UTF-8 map key
    Buffer.from([0xa1, 0x41, 0x01, 0x01]), // bytes map key
    Buffer.from([0xa1, 0x80, 0x01]), // array map key
    Buffer.from([0xa1, 0xf5, 0x01]), // boolean map key
    Buffer.from([0xb8, 65]), // oversized map
    Buffer.from([0x98, 65]), // oversized array
  ];
  for (const bytes of invalid) {
    assert.throws(() => verifyAuth(f, { cose: bytes }), undefined, bytes.toString("hex"));
    assert.throws(() => verifyAuth(f, { extensions: bytes }), undefined, bytes.toString("hex"));
  }
  // Extensions must be a string-keyed map, even for ignored values.
  for (const value of [0, [], null, new Map([[1, 3]])]) assert.throws(() => verifyAuth(f, { extensions: cbor(value) }));
  let nested = true;
  for (let i = 0; i < 10; i++) nested = [nested];
  assert.throws(() => verifyAuth(f, { extensions: cbor(new Map([["ignored", nested]])) }), /limit/);
  const tooMany = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => null));
  assert.throws(() => verifyAuth(f, { extensions: cbor(new Map([["ignored", tooMany]])) }), /limit/);
  const supportedIgnored = new Map([["ignored", [true, false, null, 500, -500, "text", Buffer.from([1, 2]), new Map([["nested", 70000]])]]]);
  assert.equal(verifyAuth(f, { extensions: cbor(supportedIgnored) }).protection, null);
});

test("accepts maximum credential ID and challenge sizes without inferring authority", () => {
  const f = fixture(), id = Buffer.alloc(1024, 7);
  assert.equal(verify(f, { id: b64(id), authenticatorData: b64(f.auth({ id })) }).credential.id, b64(id));
  const expected = { ...f.expected, challenge: Buffer.alloc(1024, 9) };
  const registration = { ...f.registration, clientDataJSON: b64(JSON.stringify({ ...f.client, challenge: b64(expected.challenge) })) };
  assert.equal(verifyBrowserRegistration(registration, expected).protection, null);
});

test("CBOR limits include the exact boundary and share one COSE-plus-extension item budget", () => {
  const f = fixture();
  let nested = null;
  for (let i = 0; i < 7; i++) nested = [nested];
  assert.equal(verifyAuth(f, { extensions: cbor(new Map([["ignored", nested]])) }).protection, null);
  assert.throws(() => verifyAuth(f, { extensions: cbor(new Map([["ignored", [nested]]])) }), /limit/);
  // COSE = 11 items; extension map/key/outer array/four arrays = 7;
  // 238 null leaves bring the single shared budget to exactly 256.
  const values = [64, 64, 64, 46].map(length => Array.from({ length }, () => null));
  assert.equal(verifyAuth(f, { extensions: cbor(new Map([["ignored", values]])) }).protection, null);
  values[3].push(null);
  assert.throws(() => verifyAuth(f, { extensions: cbor(new Map([["ignored", values]])) }), /limit/);
});

test("rejects a matching off-curve COSE/SPKI point rather than relying on later possession proof", () => {
  const f = fixture(), cose = new Map(f.cose), spki = Buffer.from(f.registration.spki, "base64url");
  cose.set(-2, Buffer.alloc(32)); cose.set(-3, Buffer.alloc(32)); spki.fill(0, spki.length - 64);
  assert.throws(() => verify(f, { spki: b64(spki), authenticatorData: b64(f.auth({ cose: cbor(cose) })) }));
});

test("runtime input and all original byte fields are bounded canonical base64url", () => {
  const f = fixture();
  for (const value of [null, undefined, [], "registration", 1]) assert.throws(() => verifyBrowserRegistration(value, f.expected));
  for (const field of ["id", "spki", "clientDataJSON", "authenticatorData"]) {
    for (const value of [null, undefined, 1, {}, "", "=", "!", `${f.registration[field]}=`]) assert.throws(() => verify(f, { [field]: value }));
  }
  assert.throws(() => verify(f, { id: b64(Buffer.alloc(1025)) }));
  assert.throws(() => verify(f, { spki: b64(Buffer.alloc(257)) }));
  // Nonzero unused bits must not be accepted as an alternate base64 encoding.
  assert.throws(() => verify(f, { id: "Zh" }));
});
