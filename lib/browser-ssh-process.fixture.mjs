// Synthetic credentials and a native socket only; no HTTP server or hardware.
import { createJiti } from "jiti";
import { fixture } from "./browser-ssh.fixture.mjs";
const { browserSshAgent } = await createJiti(import.meta.url).import("./browser-ssh-agent.ts");
const agent = browserSshAgent();
const f = fixture();
const created = agent.create("owner", f.credential, f.identity.origin);
const active = await agent.activate(created.token, "owner", f.identity.origin, f.assertion(Buffer.from(created.challenge, "base64url")));
agent.bind(created.token, "owner", f.identity.origin, "signal-session");
process.stdout.write(JSON.stringify({ socketPath: active.socketPath }) + "\n");
