import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createJiti } from "jiti";
export const protocol = await createJiti(import.meta.url).import("./browser-ssh-protocol.ts");
export function fixture(origin = "https://ssh.example.test") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const credential = { id: Buffer.from("test-credential").toString("base64url"), spki: publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
  const identity = protocol.sshIdentity(credential, origin);
  const assertion = (challenge, options = {}) => {
    const data = { type: "webauthn.get", challenge: Buffer.from(challenge).toString("base64url"), origin, crossOrigin: false, ...options.client };
    const clientData = Buffer.from(options.clientData ?? JSON.stringify(data));
    const authData = Buffer.concat([createHash("sha256").update(options.rpId ?? identity.rpId).digest(), Buffer.from([options.flags ?? 5, 0, 0, 0, 1]), options.extensions ?? Buffer.alloc(0)]);
    return { id: credential.id, clientData: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: sign("sha256", Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), privateKey).toString("base64url") };
  };
  const message = Buffer.from("browser SSH test\n");
  const digest = createHash("sha512").update(message).digest();
  const payload = Buffer.concat([Buffer.from("SSHSIG"), protocol.sshString("git"), protocol.sshString(""), protocol.sshString("sha512"), protocol.sshString(digest)]);
  return { credential, identity, assertion, payload, message };
}
