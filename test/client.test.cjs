"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createHAppsClient } = require("../dist/core.cjs");
const { createUnityBridge } = require("../dist/unity.cjs");
const { HApps } = require("../dist/index.cjs");

const PORTAL_ORIGIN = "https://hooli.games";

class FakeWindow {
  constructor() {
    this.parent = this;
    this.location = { href: "https://game.example/game" };
    this.listeners = new Map();
    this.outbound = [];
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.setInterval = setInterval;
    this.clearInterval = clearInterval;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  postMessage(message, origin) {
    this.outbound.push({ message, origin });
  }

  dispatchPortal(data) {
    for (const callback of this.listeners.get("message") || []) {
      callback({ data, origin: PORTAL_ORIGIN, source: this });
    }
  }
}

function installWindow() {
  const fakeWindow = new FakeWindow();
  global.window = fakeWindow;
  return fakeWindow;
}

function mockSuccessfulSso(signature = "game-signature") {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ signature }),
  });
}

async function createReadyClient() {
  const fakeWindow = installWindow();
  mockSuccessfulSso();
  const client = createHAppsClient();
  const ready = client.init({ platformOrigin: PORTAL_ORIGIN }).ready;
  fakeWindow.dispatchPortal({
    type: "platform_launch",
    token: "portal-token",
    userData: { id: 42, userName: "Player", verified: false },
  });
  await ready;
  return { client, fakeWindow };
}

test("isPortal:false becomes ready immediately", async () => {
  installWindow();
  const client = createHAppsClient();
  const connection = await client.init({
    platformOrigin: PORTAL_ORIGIN,
    isPortal: false,
  }).ready;

  assert.equal(client.isReady(), true);
  assert.deepEqual(connection, { user: null, signature: null });
  await assert.rejects(client.openPayment("order-1"), function(error) {
    return error.code === "NOT_IN_PORTAL";
  });
  client.destroy();
});

test("connect rejects when the portal does not answer", async () => {
  installWindow();
  const client = createHAppsClient();
  const errors = [];
  client.on("error", (error) => errors.push(error));
  const ready = client.init({
    platformOrigin: PORTAL_ORIGIN,
    operationTimeoutMs: 15,
  }).ready;

  await assert.rejects(ready, function(error) {
    return error.code === "OPERATION_TIMEOUT";
  });
  assert.equal(errors.length, 1);
  client.destroy();
});

test("exchanges the portal token for a game signature", async () => {
  const { client } = await createReadyClient();

  assert.deepEqual(client.getUser(), {
    userId: "42",
    userName: "Player",
    verified: false,
  });
  assert.equal(client.getSignature(), "game-signature");
  client.destroy();
});

test("Unity init sent before SSO is delivered after connect", async () => {
  const fakeWindow = installWindow();
  mockSuccessfulSso();
  const client = createHAppsClient();
  client.init({ platformOrigin: PORTAL_ORIGIN });
  const messages = [];
  const unity = createUnityBridge(client, {
    gameInstance: {
      SendMessage(_objectName, _methodName, message) {
        messages.push(JSON.parse(message));
      },
    },
  });

  unity.receive("init");
  fakeWindow.dispatchPortal({
    type: "platform_launch",
    token: "portal-token",
    userData: { id: 42, verified: false },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.some((message) => message.type === "init"), true);
  unity.destroy();
  client.destroy();
});

test("Unity defaults match the client and verified portal auth completes immediately", async () => {
  const fakeWindow = installWindow();
  mockSuccessfulSso();
  const client = createHAppsClient();
  const ready = client.init({ platformOrigin: PORTAL_ORIGIN }).ready;
  fakeWindow.dispatchPortal({
    type: "platform_launch",
    token: "portal-token",
    userData: { id: 42, userName: "Player", verified: true },
  });
  await ready;

  const messages = [];
  const unity = createUnityBridge(client, {
    gameInstance: {
      SendMessage(objectName, methodName, message) {
        messages.push({ objectName, methodName, message: JSON.parse(message) });
      },
    },
  });

  unity.receive("portal_auth");

  assert.equal(messages.length, 1);
  assert.equal(messages[0].objectName, "HAppsJSBridge");
  assert.equal(messages[0].methodName, "OnMessage");
  assert.deepEqual(messages[0].message, {
    type: "auth_complete",
    userData: {
      userId: "42",
      userName: "Player",
      verified: true,
    },
    signatureData: { signature: "game-signature" },
  });
  assert.equal(
    fakeWindow.outbound.some(({ message }) => message.type === "open_auth"),
    false,
  );

  unity.destroy();
  client.destroy();
});

test("payment completes only for the exact active orderId", async () => {
  const { client, fakeWindow } = await createReadyClient();
  const payment = client.openPayment("order-1");
  await Promise.resolve();

  fakeWindow.dispatchPortal({
    type: "payment_complete",
    orderId: "order-2",
    status: "paid",
  });
  fakeWindow.dispatchPortal({
    type: "payment_complete",
    orderId: "order-1",
    status: "paid",
  });

  assert.deepEqual(await payment, { orderId: "order-1", status: "paid" });
  client.destroy();
});

test("a newer auth signature supersedes an older in-flight login", async () => {
  const fakeWindow = installWindow();
  const pending = [];
  global.fetch = (_url, request) =>
    new Promise((resolve) => {
      pending.push({ token: JSON.parse(request.body).token, resolve });
    });

  const client = createHAppsClient();
  const ready = client.init({ platformOrigin: PORTAL_ORIGIN }).ready;
  fakeWindow.dispatchPortal({
    type: "platform_launch",
    token: "old-token",
    userData: { id: 1, verified: false },
  });
  fakeWindow.dispatchPortal({
    type: "auth_complete",
    token: "new-token",
    userData: { id: 1, verified: true },
  });

  pending.find((item) => item.token === "new-token").resolve({
    ok: true,
    json: async () => ({ signature: "new-signature" }),
  });
  await ready;
  pending.find((item) => item.token === "old-token").resolve({
    ok: true,
    json: async () => ({ signature: "old-signature" }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.getSignature(), "new-signature");
  assert.equal(client.getUser().verified, true);
  client.destroy();
});

test("full entry keeps legacy Unity init configuration", async () => {
  installWindow();
  const gameInstance = { SendMessage() {} };
  const result = HApps.init({
    platformOrigin: PORTAL_ORIGIN,
    isPortal: false,
    gameInstance,
    unityObjectName: "LegacyManager",
    unityMethodName: "OnLegacyMessage",
  });

  await result.ready;
  assert.equal(typeof HApps.unity.receive, "function");
  assert.equal(typeof HApps.onUnityEvent, "function");
  HApps.destroy();
});

test("full entry queues Unity events until attach", async () => {
  const fakeWindow = installWindow();
  mockSuccessfulSso();
  const messages = [];

  HApps.onUnityEvent("init");
  const ready = HApps.init({ platformOrigin: PORTAL_ORIGIN }).ready;
  HApps.unity.attach({
    gameInstance: {
      SendMessage(_objectName, _methodName, message) {
        messages.push(JSON.parse(message));
      },
    },
  });
  fakeWindow.dispatchPortal({
    type: "platform_launch",
    token: "portal-token",
    userData: { id: 42, verified: false },
  });

  await ready;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.filter((message) => message.type === "init").length, 1);
  HApps.destroy();
});

test("Unity receives one payment failure on timeout", async () => {
  const fakeWindow = installWindow();
  mockSuccessfulSso();
  const client = createHAppsClient();
  const ready = client.init({
    platformOrigin: PORTAL_ORIGIN,
    operationTimeoutMs: 15,
  }).ready;
  fakeWindow.dispatchPortal({
    type: "platform_launch",
    token: "portal-token",
    userData: { id: 42, verified: false },
  });
  await ready;

  const messages = [];
  const unity = createUnityBridge(client, {
    gameInstance: {
      SendMessage(_objectName, _methodName, message) {
        messages.push(JSON.parse(message));
      },
    },
  });
  unity.receive("open_payment", JSON.stringify({ orderId: "order-timeout" }));
  await new Promise((resolve) => setTimeout(resolve, 35));

  const failures = messages.filter(
    (message) =>
      message.type === "payment" && message.paymentData.status === "fail",
  );
  assert.equal(failures.length, 1);
  unity.destroy();
  client.destroy();
});
