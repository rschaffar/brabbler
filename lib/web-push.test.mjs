import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./web-push.ts");
}

const { createWebPushNotifier, localeText } = await loadSubject();

function makeEnvironment({
  initialState = null,
  sessionNames = new Map([["session-1", "My session"]]),
  errorFor = () => null,
} = {}) {
  let state = initialState;
  let saved = null;
  const sent = [];

  const env = {
    send: async (subscription, payload, vapidKeys) => {
      sent.push({ subscription, payload, vapidKeys });
      const error = errorFor(subscription);
      if (error) throw error;
    },
    loadState: () => state,
    saveState: (s) => { saved = s; },
    generateVapidKeys: () => ({ publicKey: "pub-key", privateKey: "priv-key" }),
    listSessionNames: async () => sessionNames,
  };

  return {
    notifier: createWebPushNotifier(env),
    sent,
    getSaved: () => saved,
  };
}

const SUB_EN = {
  endpoint: "https://push.example.com/en",
  keys: { p256dh: "p256dh-en", auth: "auth-en" },
  locale: "en",
};
const SUB_ZH = {
  endpoint: "https://push.example.com/zh",
  keys: { p256dh: "p256dh-zh", auth: "auth-zh" },
  locale: "zh-CN",
};

test("generates and persists VAPID keys when no state exists", () => {
  const { notifier, getSaved } = makeEnvironment();

  assert.equal(notifier.getVapidPublicKey(), "pub-key");
  assert.deepEqual(getSaved(), {
    vapidKeys: { publicKey: "pub-key", privateKey: "priv-key" },
    subscriptions: [],
  });
});

test("reuses persisted VAPID keys", () => {
  const { notifier } = makeEnvironment({
    initialState: {
      vapidKeys: { publicKey: "persisted-pub", privateKey: "persisted-priv" },
      subscriptions: [],
    },
  });

  assert.equal(notifier.getVapidPublicKey(), "persisted-pub");
});

test("addSubscription upserts by endpoint and persists", () => {
  const { notifier, getSaved } = makeEnvironment();

  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);
  notifier.addSubscription({ ...SUB_EN, locale: "zh-CN" });

  const saved = getSaved();
  assert.equal(saved.subscriptions.length, 2);
  const updated = saved.subscriptions.find((s) => s.endpoint === SUB_EN.endpoint);
  assert.equal(updated.locale, "zh-CN");
});

test("addSubscription persists even after getVapidPublicKey already saved", () => {
  const { notifier, getSaved } = makeEnvironment();

  notifier.getVapidPublicKey(); // first save
  notifier.addSubscription(SUB_EN);

  assert.equal(getSaved().subscriptions.length, 1);
});

test("notifySessionComplete sends English payloads including legacy subscriptions", async () => {
  const { notifier, sent } = makeEnvironment();
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  await notifier.notifySessionComplete("session-1");

  assert.equal(sent.length, 2);
  const en = sent.find((s) => s.subscription.endpoint === SUB_EN.endpoint);
  const zh = sent.find((s) => s.subscription.endpoint === SUB_ZH.endpoint);
  assert.deepEqual(JSON.parse(en.payload), {
    title: "My session",
    body: "Task finished.",
    url: "/?session=session-1",
    tag: "brabbler-session-complete:session-1",
  });
  assert.deepEqual(JSON.parse(zh.payload), {
    title: "My session",
    body: "Task finished.",
    url: "/?session=session-1",
    tag: "brabbler-session-complete:session-1",
  });
});

test("notifySessionComplete uses an English generic title for stored non-English subscriptions", async () => {
  const { notifier, sent } = makeEnvironment({
    sessionNames: new Map(),
    initialState: { vapidKeys: { publicKey: "pub-key", privateKey: "priv-key" }, subscriptions: [SUB_ZH] },
  });

  await notifier.notifySessionComplete("unknown-session");

  assert.deepEqual(JSON.parse(sent[0].payload), {
    title: "Session complete",
    body: "Task finished.",
    url: "/?session=unknown-session",
    tag: "brabbler-session-complete:unknown-session",
  });
});

test("notifySessionComplete prunes subscriptions dropped by the push service", async () => {
  const { notifier, sent, getSaved } = makeEnvironment({
    errorFor: (subscription) => subscription.endpoint === SUB_ZH.endpoint ? { statusCode: 410 } : null,
  });
  notifier.addSubscription(SUB_EN);
  notifier.addSubscription(SUB_ZH);

  await notifier.notifySessionComplete("session-1");

  assert.equal(sent.length, 2);
  const saved = getSaved();
  assert.deepEqual(saved.subscriptions.map((s) => s.endpoint), [SUB_EN.endpoint]);
});

test("localeText always uses English regardless of legacy locale", () => {
  assert.equal(localeText("zh-CN", "taskFinished"), "Task finished.");
  assert.equal(localeText("zh-TW", "taskFinished"), "Task finished.");
  assert.equal(localeText("ja", "taskFinished"), "Task finished.");
  assert.equal(localeText("en", "sessionComplete"), "Session complete");
});

test("push requests immediate delivery with a long TTL", async () => {
  const { PUSH_OPTIONS } = await loadSubject();

  // iOS may defer non-high-urgency pushes to an arbitrary later window.
  assert.equal(PUSH_OPTIONS.urgency, "high");
  assert.equal(PUSH_OPTIONS.TTL, 2419200);
});

test("VAPID contact is explicit rather than claiming upstream ownership", async t => {
  const original = process.env.BRABBLER_PUSH_SUBJECT;
  t.after(() => {
    if (original === undefined) delete process.env.BRABBLER_PUSH_SUBJECT;
    else process.env.BRABBLER_PUSH_SUBJECT = original;
  });
  const { vapidSubject } = await loadSubject();
  delete process.env.BRABBLER_PUSH_SUBJECT;
  assert.throws(() => vapidSubject(), /Set BRABBLER_PUSH_SUBJECT/);
  process.env.BRABBLER_PUSH_SUBJECT = "  mailto:operator@example.invalid  ";
  assert.equal(vapidSubject(), "mailto:operator@example.invalid");
  process.env.BRABBLER_PUSH_SUBJECT = "https://example.invalid/contact";
  assert.equal(vapidSubject(), "https://example.invalid/contact");
  process.env.BRABBLER_PUSH_SUBJECT = "http://example.invalid/contact";
  assert.throws(() => vapidSubject(), /mailto: or https:/);
  process.env.BRABBLER_PUSH_SUBJECT = "mailto:";
  assert.throws(() => vapidSubject(), /operator contact/);
});

test("public push setup refuses absent or invalid contact before creating state", async t => {
  const original = process.env.BRABBLER_PUSH_SUBJECT;
  const notifier = globalThis.__brabblerPushNotifier;
  t.after(() => {
    if (original === undefined) delete process.env.BRABBLER_PUSH_SUBJECT;
    else process.env.BRABBLER_PUSH_SUBJECT = original;
  });
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, fsCache: false });
  const { GET } = await jiti.import("../app/api/push/config/route.ts");
  const { POST } = await jiti.import("../app/api/push/subscribe/route.ts");
  for (const value of [undefined, "http://example.invalid/contact", "mailto:"]) {
    if (value === undefined) delete process.env.BRABBLER_PUSH_SUBJECT;
    else process.env.BRABBLER_PUSH_SUBJECT = value;
    const configuration = await GET();
    assert.equal(configuration.status, 503);
    assert.match((await configuration.json()).error, /BRABBLER_PUSH_SUBJECT/);
    const subscription = await POST(new Request("http://localhost/api/push/subscribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: SUB_EN }),
    }));
    assert.equal(subscription.status, 503);
    assert.match((await subscription.json()).error, /BRABBLER_PUSH_SUBJECT/);
    assert.equal(globalThis.__brabblerPushNotifier, notifier, "configuration failure must not initialize or write push state");
  }
});
