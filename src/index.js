import { createHAppsClient, SDK_VERSION } from "./client.js";
import { ErrorCodes } from "./errors.js";
import { createUnityBridge } from "./unity.js";

var client = createHAppsClient();
var bridge = null;
var pendingUnityEvents = [];

var unity = Object.freeze({
  attach: function(config) {
    if (bridge) bridge.destroy();
    bridge = createUnityBridge(client, config);
    var queuedEvents = pendingUnityEvents;
    pendingUnityEvents = [];
    for (var i = 0; i < queuedEvents.length; i += 1) {
      bridge.receive(queuedEvents[i].type, queuedEvents[i].payloadJson);
    }
    return bridge;
  },
  receive: function(type, payloadJson) {
    if (!bridge) {
      pendingUnityEvents.push({ type: type, payloadJson: payloadJson });
      return;
    }
    bridge.receive(type, payloadJson);
  },
  detach: function() {
    if (bridge) bridge.destroy();
    bridge = null;
  },
});

var coreInit = client.init.bind(client);
var coreDestroy = client.destroy.bind(client);

client.init = function(config) {
  config = config || {};
  var coreConfig = {
    platformOrigin: config.platformOrigin,
    ssoLoginUrl: config.ssoLoginUrl,
    isPortal: config.isPortal,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    operationTimeoutMs: config.operationTimeoutMs,
    debug: config.debug,
  };
  var result = coreInit(coreConfig);
  if (config.gameInstance) {
    unity.attach({
      gameInstance: config.gameInstance,
      objectName: config.unityObjectName,
      methodName: config.unityMethodName,
    });
  }
  return result;
};

client.destroy = function() {
  unity.detach();
  pendingUnityEvents = [];
  coreDestroy();
};

Object.defineProperties(client, {
  unity: { value: unity, enumerable: true },
  onUnityEvent: {
    value: function(type, payloadJson) {
      unity.receive(type, payloadJson);
    },
    enumerable: true,
  },
});

export { createHAppsClient, createUnityBridge, ErrorCodes, SDK_VERSION };
export { client as HApps };
export default client;
