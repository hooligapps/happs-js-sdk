(() => {
  // src/errors.js
  var ErrorCodes = Object.freeze({
    LOGIN_FAILED: "LOGIN_FAILED",
    INVALID_CONFIG: "INVALID_CONFIG",
    NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
    INVALID_PAYLOAD: "INVALID_PAYLOAD",
    NETWORK_ERROR: "NETWORK_ERROR",
    ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
    NOT_INITIALIZED: "NOT_INITIALIZED",
    NOT_IN_PORTAL: "NOT_IN_PORTAL",
    OPERATION_IN_PROGRESS: "OPERATION_IN_PROGRESS",
    OPERATION_TIMEOUT: "OPERATION_TIMEOUT"
  });
  function makeError(code, message) {
    return { code, message };
  }
  function getErrorMessage(error) {
    if (error && typeof error === "object" && "message" in error) {
      return String(error.message);
    }
    return String(error);
  }
  function normalizeError(error) {
    if (error && typeof error === "object" && typeof error.code === "string" && typeof error.message === "string") {
      return error;
    }
    return makeError(ErrorCodes.INVALID_PAYLOAD, getErrorMessage(error));
  }

  // src/emitter.js
  function createEmitter() {
    var listeners = /* @__PURE__ */ Object.create(null);
    function on(eventType, callback) {
      if (typeof callback !== "function") {
        throw new TypeError("Event callback must be a function");
      }
      if (!listeners[eventType]) listeners[eventType] = [];
      listeners[eventType].push(callback);
      return function unsubscribe() {
        off(eventType, callback);
      };
    }
    function once(eventType, callback) {
      var unsubscribe = on(eventType, function(data) {
        unsubscribe();
        callback(data);
      });
      return unsubscribe;
    }
    function off(eventType, callback) {
      if (!listeners[eventType]) return;
      listeners[eventType] = listeners[eventType].filter(function(listener) {
        return listener !== callback;
      });
    }
    function emit(eventType, data) {
      var current = (listeners[eventType] || []).slice();
      for (var i = 0; i < current.length; i += 1) {
        try {
          current[i](data);
        } catch (_) {
        }
      }
    }
    function clear() {
      listeners = /* @__PURE__ */ Object.create(null);
    }
    return { on, once, off, emit, clear };
  }

  // src/protocol.js
  var ALLOWED_PLATFORM_MESSAGES = Object.freeze({
    platform_launch: true,
    auth_complete: true,
    payment_complete: true,
    profile_updated: true
  });
  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function isValidUserData(value) {
    return isObject(value) && (typeof value.id === "string" || typeof value.id === "number") && typeof value.verified === "boolean";
  }
  function validatePlatformMessage(data) {
    if (!isObject(data)) return "Message is not an object";
    if (typeof data.type !== "string") return "Message type is not a string";
    if (!ALLOWED_PLATFORM_MESSAGES[data.type]) {
      return "Unknown message type: " + data.type;
    }
    if (data.type === "platform_launch") {
      if (typeof data.signature !== "string" && typeof data.token !== "string") {
        return "platform_launch requires signature string";
      }
      if (!isValidUserData(data.userData)) {
        return "platform_launch requires valid userData";
      }
    }
    if (data.type === "auth_complete") {
      if (data.signature !== void 0 && typeof data.signature !== "string") {
        return "auth_complete signature must be a string";
      }
      if (data.token !== void 0 && typeof data.token !== "string") {
        return "auth_complete token must be a string";
      }
      if (data.userData !== void 0 && !isValidUserData(data.userData)) {
        return "auth_complete userData is invalid";
      }
    }
    if (data.type === "payment_complete") {
      if (typeof data.orderId !== "string" || !data.orderId) {
        return "payment_complete requires orderId string";
      }
      if (typeof data.status !== "string" || !data.status) {
        return "payment_complete requires status string";
      }
    }
    if (data.type === "profile_updated" && typeof data.verified !== "boolean") {
      return "profile_updated verified must be boolean";
    }
    return null;
  }
  function extractSignature(data) {
    if (data && typeof data.signature === "string") return data.signature;
    if (data && typeof data.token === "string") return data.token;
    return null;
  }
  function extractUser(data) {
    if (!data || !isValidUserData(data.userData)) return null;
    return {
      userId: String(data.userData.id),
      userName: typeof data.userData.userName === "string" ? data.userData.userName : void 0,
      verified: data.userData.verified
    };
  }

  // src/portal-transport.js
  function createPortalTransport(browserWindow, platformOrigin, onMessage) {
    function handleMessage(event) {
      if (event.origin !== platformOrigin) return;
      if (event.source !== browserWindow.parent) return;
      onMessage(event.data);
    }
    return {
      start: function() {
        browserWindow.addEventListener("message", handleMessage, false);
      },
      post: function(message) {
        browserWindow.parent.postMessage(message, platformOrigin);
      },
      destroy: function() {
        browserWindow.removeEventListener("message", handleMessage, false);
      }
    };
  }

  // src/client.js
  var SDK_VERSION = "1.1.0";
  var DEFAULTS = Object.freeze({
    ssoLoginUrl: "/api/sign",
    isPortal: true,
    maxRetries: 3,
    retryDelayMs: 1e3,
    operationTimeoutMs: 18e4,
    debug: false
  });
  function wait(delayMs) {
    return new Promise(function(resolve) {
      globalThis.setTimeout(resolve, delayMs);
    });
  }
  function createHAppsClient(initialConfig) {
    var config = null;
    var browserWindow = null;
    var transport = null;
    var userData = null;
    var signatureData = null;
    var initialized = false;
    var ready = false;
    var isPortal = false;
    var readyPromise = null;
    var readyResolve = null;
    var readyReject = null;
    var readyTimeoutId = null;
    var loginGeneration = 0;
    var activePayment = null;
    var activeAuthPopup = null;
    var cancelAuthPopup = null;
    var emitter = createEmitter();
    function log() {
      if (!config || !config.debug || !globalThis.console) return;
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[HApps]");
      globalThis.console.log.apply(globalThis.console, args);
    }
    function requireInitialized() {
      if (!initialized) {
        throw makeError(
          ErrorCodes.NOT_INITIALIZED,
          "Call HApps.init() before using the SDK"
        );
      }
    }
    function getConnection() {
      return {
        user: HApps.getUser(),
        signature: HApps.getSignature()
      };
    }
    function postToPortal(message) {
      requireInitialized();
      if (!isPortal) {
        throw makeError(
          ErrorCodes.NOT_IN_PORTAL,
          "This operation is available only inside the portal"
        );
      }
      transport.post(message);
    }
    function waitForEvent(eventType, startAction) {
      return new Promise(function(resolve, reject) {
        var unsubscribe = function() {
        };
        var timeoutId = browserWindow.setTimeout(function() {
          unsubscribe();
          reject(
            makeError(
              ErrorCodes.OPERATION_TIMEOUT,
              eventType + " did not complete before timeout"
            )
          );
        }, config.operationTimeoutMs);
        unsubscribe = HApps.once(eventType, function(data) {
          browserWindow.clearTimeout(timeoutId);
          resolve(data);
        });
        try {
          startAction();
        } catch (error) {
          browserWindow.clearTimeout(timeoutId);
          unsubscribe();
          reject(error);
        }
      });
    }
    async function loginWithPlatformSignature(signature, emitAuthComplete) {
      var generation = ++loginGeneration;
      for (var attempt = 1; attempt <= config.maxRetries; attempt += 1) {
        try {
          var response = await globalThis.fetch(config.ssoLoginUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: signature })
          });
          if (!response.ok) {
            throw new Error("SSO login failed with status " + response.status);
          }
          var data = await response.json();
          if (!data || typeof data.signature !== "string") {
            throw new Error("Invalid SSO response: expected { signature: string }");
          }
          if (!userData) {
            throw new Error("Invalid platform launch: no userData");
          }
          if (generation !== loginGeneration || !initialized) return;
          signatureData = { signature: data.signature };
          var firstReady = !ready;
          ready = true;
          var connection = getConnection();
          if (firstReady) {
            if (readyTimeoutId !== null) {
              browserWindow.clearTimeout(readyTimeoutId);
              readyTimeoutId = null;
            }
            if (readyResolve) readyResolve(connection);
            readyResolve = null;
            readyReject = null;
            emitter.emit("ready", connection);
          }
          if (emitAuthComplete) {
            emitter.emit("auth_complete", {
              type: "auth_complete",
              userData: connection.user || void 0,
              signatureData
            });
          }
          return;
        } catch (error) {
          if (generation !== loginGeneration || !initialized) return;
          if (attempt < config.maxRetries) {
            await wait(attempt * config.retryDelayMs);
            continue;
          }
          var sdkError = makeError(
            ErrorCodes.LOGIN_FAILED,
            getErrorMessage(error)
          );
          emitter.emit("error", sdkError);
          if (!ready && readyReject) {
            if (readyTimeoutId !== null) {
              browserWindow.clearTimeout(readyTimeoutId);
              readyTimeoutId = null;
            }
            readyReject(sdkError);
            readyResolve = null;
            readyReject = null;
          }
        }
      }
    }
    function handlePlatformMessage(data) {
      log("Portal event", data && data.type);
      var validationError = validatePlatformMessage(data);
      if (validationError) {
        emitter.emit(
          "error",
          makeError(ErrorCodes.INVALID_PAYLOAD, validationError)
        );
        return;
      }
      switch (data.type) {
        case "platform_launch":
          userData = extractUser(data);
          void loginWithPlatformSignature(extractSignature(data), false);
          break;
        case "auth_complete": {
          var authUser = extractUser(data);
          if (authUser) userData = authUser;
          var authSignature = extractSignature(data);
          if (authSignature) {
            void loginWithPlatformSignature(authSignature, true);
          } else {
            emitter.emit("auth_complete", { type: "auth_complete" });
          }
          break;
        }
        case "profile_updated":
          if (!userData) return;
          userData = {
            userId: userData.userId,
            userName: userData.userName,
            verified: data.verified
          };
          emitter.emit("user_changed", {
            type: "user_changed",
            userData: HApps.getUser()
          });
          break;
        case "payment_complete": {
          if (!activePayment || data.orderId !== activePayment.orderId) return;
          var payment = activePayment;
          activePayment = null;
          browserWindow.clearTimeout(payment.timeoutId);
          var paymentData = { orderId: data.orderId, status: data.status };
          emitter.emit("payment_complete", {
            type: "payment_complete",
            paymentData
          });
          payment.resolve(paymentData);
          break;
        }
      }
    }
    function init(cfg) {
      var _a, _b, _c, _d, _e, _f;
      if (initialized) {
        throw makeError(
          ErrorCodes.ALREADY_INITIALIZED,
          "HApps.init() has already been called. Use destroy() first to reinitialize."
        );
      }
      cfg = cfg || {};
      if (!cfg.platformOrigin) {
        throw makeError(ErrorCodes.INVALID_CONFIG, "platformOrigin is required");
      }
      if (typeof window === "undefined") {
        throw makeError(ErrorCodes.INVALID_CONFIG, "HApps requires a browser window");
      }
      var platformUrl;
      try {
        platformUrl = new URL(cfg.platformOrigin, window.location.href);
      } catch (_) {
        throw makeError(
          ErrorCodes.INVALID_CONFIG,
          "platformOrigin must be a valid URL"
        );
      }
      if (platformUrl.protocol !== "https:" && platformUrl.protocol !== "http:") {
        throw makeError(
          ErrorCodes.INVALID_CONFIG,
          "platformOrigin must use http or https"
        );
      }
      var maxRetries = (_a = cfg.maxRetries) != null ? _a : DEFAULTS.maxRetries;
      var retryDelayMs = (_b = cfg.retryDelayMs) != null ? _b : DEFAULTS.retryDelayMs;
      var operationTimeoutMs = (_c = cfg.operationTimeoutMs) != null ? _c : DEFAULTS.operationTimeoutMs;
      if (!Number.isInteger(maxRetries) || maxRetries < 1) {
        throw makeError(
          ErrorCodes.INVALID_CONFIG,
          "maxRetries must be a positive integer"
        );
      }
      if (retryDelayMs < 0 || operationTimeoutMs <= 0) {
        throw makeError(
          ErrorCodes.INVALID_CONFIG,
          "Timeout values must be positive"
        );
      }
      browserWindow = window;
      config = {
        platformOrigin: platformUrl.origin,
        ssoLoginUrl: (_d = cfg.ssoLoginUrl) != null ? _d : DEFAULTS.ssoLoginUrl,
        isPortal: (_e = cfg.isPortal) != null ? _e : DEFAULTS.isPortal,
        maxRetries,
        retryDelayMs,
        operationTimeoutMs,
        debug: (_f = cfg.debug) != null ? _f : DEFAULTS.debug
      };
      isPortal = config.isPortal;
      initialized = true;
      if (!isPortal) {
        ready = true;
        readyPromise = Promise.resolve(getConnection());
        log("Initialized outside portal", { version: SDK_VERSION });
        return { ready: readyPromise };
      }
      readyPromise = new Promise(function(resolve, reject) {
        readyResolve = resolve;
        readyReject = reject;
      });
      readyTimeoutId = browserWindow.setTimeout(function() {
        if (ready || !readyReject) return;
        readyTimeoutId = null;
        var error = makeError(
          ErrorCodes.OPERATION_TIMEOUT,
          "Portal connection did not complete before timeout"
        );
        emitter.emit("error", error);
        readyReject(error);
        readyResolve = null;
        readyReject = null;
      }, config.operationTimeoutMs);
      transport = createPortalTransport(
        browserWindow,
        config.platformOrigin,
        handlePlatformMessage
      );
      transport.start();
      transport.post({
        type: "sdk_ready",
        sdkVersion: SDK_VERSION,
        capabilities: [
          "get_profile",
          "open_payment",
          "open_external_url",
          "popup_auth",
          "portal_auth",
          "open_age_verification",
          "set_fullscreen",
          "set_theater_mode"
        ]
      });
      transport.post({ type: "request_launch_token" });
      log("Initialized", {
        version: SDK_VERSION,
        platformOrigin: config.platformOrigin
      });
      return { ready: readyPromise };
    }
    function openIdpAuthPopup(url, callbackOrigin) {
      try {
        requireInitialized();
      } catch (error) {
        return Promise.reject(error);
      }
      if (activeAuthPopup) {
        return Promise.reject(
          makeError(
            ErrorCodes.OPERATION_IN_PROGRESS,
            "Authentication popup is already open"
          )
        );
      }
      function resolveImmediately(result) {
        emitter.emit("popup_auth_result", {
          type: "popup_auth_result",
          authPopupData: result
        });
        return Promise.resolve(result);
      }
      var popupUrl;
      var callbackUrl;
      try {
        popupUrl = new URL(url, browserWindow.location.href);
        callbackUrl = callbackOrigin ? new URL(callbackOrigin, browserWindow.location.href) : popupUrl;
      } catch (_) {
        return resolveImmediately({ flow: "cancelled" });
      }
      if (popupUrl.protocol !== "https:" && popupUrl.protocol !== "http:" || callbackUrl.protocol !== "https:" && callbackUrl.protocol !== "http:") {
        return resolveImmediately({ flow: "cancelled" });
      }
      var width = 440;
      var height = 630;
      var screenLeft = browserWindow.screenLeft !== void 0 ? browserWindow.screenLeft : browserWindow.screenX;
      var screenTop = browserWindow.screenTop !== void 0 ? browserWindow.screenTop : browserWindow.screenY;
      var windowWidth = browserWindow.innerWidth || browserWindow.document.documentElement.clientWidth || browserWindow.screen.width;
      var windowHeight = browserWindow.innerHeight || browserWindow.document.documentElement.clientHeight || browserWindow.screen.height;
      var left = screenLeft + (windowWidth - width) / 2;
      var top = screenTop + (windowHeight - height) / 2;
      var popup = browserWindow.open(
        popupUrl.toString(),
        "hooligapps_auth_popup",
        "width=" + width + ",height=" + height + ",left=" + left + ",top=" + top + ",resizable=no,scrollbars=yes"
      );
      if (!popup) return resolveImmediately({ flow: "cancelled" });
      activeAuthPopup = popup;
      return new Promise(function(resolve) {
        var completed = false;
        var expectedOrigin = callbackUrl.origin;
        var closedInterval;
        var timeoutId;
        function finish(result) {
          if (completed) return;
          completed = true;
          browserWindow.removeEventListener("message", onMessage, false);
          browserWindow.clearInterval(closedInterval);
          browserWindow.clearTimeout(timeoutId);
          try {
            popup.close();
          } catch (_) {
          }
          activeAuthPopup = null;
          cancelAuthPopup = null;
          emitter.emit("popup_auth_result", {
            type: "popup_auth_result",
            authPopupData: result
          });
          resolve(result);
        }
        function onMessage(event) {
          if (event.origin !== expectedOrigin || event.source !== popup) return;
          var data = event.data;
          if (!data || typeof data !== "object") return;
          if (data.type === "auth_ticket" && typeof data.ticket === "string" && data.ticket) {
            finish({ flow: "ticket", ticket: data.ticket });
          } else if (data.type === "auth_done") {
            finish({ flow: "cookie" });
          }
        }
        browserWindow.addEventListener("message", onMessage, false);
        closedInterval = browserWindow.setInterval(function() {
          try {
            if (popup.closed) finish({ flow: "cancelled" });
          } catch (_) {
          }
        }, 500);
        timeoutId = browserWindow.setTimeout(function() {
          finish({ flow: "cancelled" });
        }, config.operationTimeoutMs);
        cancelAuthPopup = function() {
          finish({ flow: "cancelled" });
        };
      });
    }
    var HApps = {
      ErrorCodes,
      init,
      connect: function() {
        try {
          requireInitialized();
        } catch (error) {
          return Promise.reject(error);
        }
        return ready ? Promise.resolve(getConnection()) : readyPromise;
      },
      on: function(eventType, callback) {
        return emitter.on(eventType, callback);
      },
      once: function(eventType, callback) {
        return emitter.once(eventType, callback);
      },
      off: function(eventType, callback) {
        emitter.off(eventType, callback);
      },
      getUser: function() {
        return userData ? {
          userId: userData.userId,
          userName: userData.userName,
          verified: userData.verified
        } : null;
      },
      getSignature: function() {
        return signatureData ? signatureData.signature : null;
      },
      getProfile: function() {
        return HApps.connect().then(function(connection) {
          return connection.user;
        });
      },
      isReady: function() {
        return ready;
      },
      isPortal: function() {
        return isPortal;
      },
      getVersion: function() {
        return SDK_VERSION;
      },
      requestAuth: function() {
        requireInitialized();
        if (userData && userData.verified) return;
        postToPortal({ type: "open_auth" });
      },
      openPortalAuth: function() {
        return HApps.connect().then(function(connection) {
          if (connection.user && connection.user.verified) return connection;
          return waitForEvent("auth_complete", HApps.requestAuth).then(
            getConnection
          );
        });
      },
      openIdpAuthPopup,
      openPayment: async function(orderId) {
        requireInitialized();
        if (typeof orderId !== "string" || !orderId) {
          throw makeError(ErrorCodes.INVALID_PAYLOAD, "orderId is required");
        }
        await HApps.connect();
        if (!isPortal) {
          throw makeError(
            ErrorCodes.NOT_IN_PORTAL,
            "openPayment is available only inside the portal"
          );
        }
        if (activePayment) {
          throw makeError(
            ErrorCodes.OPERATION_IN_PROGRESS,
            "Payment is already in progress"
          );
        }
        return new Promise(function(resolve, reject) {
          var timeoutId = browserWindow.setTimeout(function() {
            if (!activePayment || activePayment.orderId !== orderId) return;
            activePayment = null;
            var error = makeError(
              ErrorCodes.OPERATION_TIMEOUT,
              "Payment " + orderId + " did not complete before timeout"
            );
            emitter.emit("payment", {
              type: "payment",
              paymentData: {
                status: "fail",
                orderId,
                error: "operation_timeout"
              }
            });
            reject(error);
          }, config.operationTimeoutMs);
          activePayment = {
            orderId,
            resolve,
            reject,
            timeoutId
          };
          emitter.emit("payment", {
            type: "payment",
            paymentData: { status: "started", orderId }
          });
          postToPortal({ type: "open_checkout", orderId });
        });
      },
      openExternalUrl: function(url) {
        if (typeof url !== "string" || !url.trim()) {
          throw makeError(ErrorCodes.INVALID_PAYLOAD, "url is required");
        }
        postToPortal({ type: "open_external_url", url: url.trim() });
      },
      setFullscreen: function(enabled) {
        postToPortal({ type: "set_fullscreen", enabled: !!enabled });
      },
      setTheaterMode: function(enabled) {
        postToPortal({ type: "set_theater_mode", enabled: !!enabled });
      },
      openAgeVerification: function(payload) {
        postToPortal({
          type: "open_age_verification",
          adultMode: !payload || payload.adultMode !== false
        });
      },
      destroy: function() {
        loginGeneration += 1;
        if (transport) transport.destroy();
        transport = null;
        if (readyTimeoutId !== null) {
          browserWindow.clearTimeout(readyTimeoutId);
          readyTimeoutId = null;
        }
        if (cancelAuthPopup) cancelAuthPopup();
        cancelAuthPopup = null;
        if (activePayment) {
          browserWindow.clearTimeout(activePayment.timeoutId);
          activePayment.reject(
            makeError(
              ErrorCodes.NOT_INITIALIZED,
              "SDK was destroyed during payment"
            )
          );
          activePayment = null;
        }
        if (!ready && readyReject) {
          readyReject(
            makeError(
              ErrorCodes.NOT_INITIALIZED,
              "SDK was destroyed before it became ready"
            )
          );
        }
        emitter.clear();
        config = null;
        browserWindow = null;
        userData = null;
        signatureData = null;
        initialized = false;
        ready = false;
        isPortal = false;
        readyPromise = null;
        readyResolve = null;
        readyReject = null;
        activeAuthPopup = null;
      }
    };
    if (initialConfig) HApps.init(initialConfig);
    return HApps;
  }

  // src/unity.js
  function createUnityBridge(client2, bridgeConfig) {
    if (!client2 || typeof client2.connect !== "function") {
      throw new TypeError("A HApps client instance is required");
    }
    if (!bridgeConfig || !bridgeConfig.gameInstance || typeof bridgeConfig.gameInstance.SendMessage !== "function") {
      throw new TypeError("gameInstance.SendMessage is required");
    }
    var gameInstance = bridgeConfig.gameInstance;
    var objectName = bridgeConfig.objectName || "HAppsJSBridge";
    var methodName = bridgeConfig.methodName || "OnMessage";
    var destroyed = false;
    var unsubscribers = [
      client2.on("auth_complete", send),
      client2.on("user_changed", send),
      client2.on("payment", send),
      client2.on("payment_complete", send),
      client2.on("popup_auth_result", send),
      client2.on("error", function(error) {
        send({ type: "error", error });
      })
    ];
    function send(message) {
      if (destroyed) return;
      gameInstance.SendMessage(
        objectName,
        methodName,
        JSON.stringify(message)
      );
    }
    function sendError(error) {
      send({ type: "error", error: normalizeError(error) });
    }
    async function connect(type) {
      try {
        var connection = await client2.connect();
        if (!connection.user) {
          sendError(
            makeError(ErrorCodes.NOT_AUTHENTICATED, "User not authenticated")
          );
          return;
        }
        send({
          type,
          userData: connection.user,
          signatureData: connection.signature ? { signature: connection.signature } : null,
          initData: { ready: true, fromPlatform: true }
        });
      } catch (error) {
        var normalized = normalizeError(error);
        if (normalized.code !== ErrorCodes.LOGIN_FAILED && normalized.code !== ErrorCodes.OPERATION_TIMEOUT) {
          sendError(normalized);
        }
      }
    }
    async function getProfile() {
      try {
        var user = await client2.getProfile();
        if (!user) {
          send({
            type: "profile",
            error: makeError(
              ErrorCodes.NOT_AUTHENTICATED,
              "User not authenticated"
            )
          });
          return;
        }
        send({ type: "profile", userData: user });
      } catch (error) {
        send({ type: "profile", error: normalizeError(error) });
      }
    }
    function openPortalAuth() {
      var user = client2.getUser();
      if (user && user.verified) {
        var signature = client2.getSignature();
        send({
          type: "auth_complete",
          userData: user,
          signatureData: signature ? { signature } : null
        });
        return;
      }
      run(client2.requestAuth);
    }
    async function openPayment(payload) {
      if (typeof payload.orderId !== "string" || !payload.orderId) {
        send({
          type: "payment",
          paymentData: { status: "fail", error: "invalid_payload" }
        });
        return;
      }
      try {
        await client2.openPayment(payload.orderId);
      } catch (error) {
        var normalized = normalizeError(error);
        if (normalized.code === ErrorCodes.OPERATION_TIMEOUT) return;
        send({
          type: "payment",
          paymentData: {
            status: "fail",
            orderId: payload.orderId,
            error: normalized.code.toLowerCase()
          }
        });
      }
    }
    async function openPopup(payload) {
      if (typeof payload.url !== "string" || !payload.url) {
        send({
          type: "popup_auth_result",
          authPopupData: { flow: "cancelled" }
        });
        return;
      }
      try {
        await client2.openIdpAuthPopup(
          payload.url,
          typeof payload.callbackOrigin === "string" ? payload.callbackOrigin : void 0
        );
      } catch (error) {
        sendError(error);
      }
    }
    function openExternalUrl(payload) {
      if (typeof payload.url !== "string" || !payload.url.trim()) {
        sendError(makeError(ErrorCodes.INVALID_PAYLOAD, "url is required"));
        return;
      }
      client2.openExternalUrl(payload.url);
    }
    function run(action) {
      try {
        action();
      } catch (error) {
        sendError(error);
      }
    }
    function receive(type, payloadJson) {
      if (destroyed) return;
      var payload = {};
      try {
        if (payloadJson) payload = JSON.parse(payloadJson);
      } catch (error) {
        sendError(
          makeError(
            ErrorCodes.INVALID_PAYLOAD,
            "Failed to parse Unity payload: " + normalizeError(error).message
          )
        );
        return;
      }
      switch (type) {
        case "init":
        case "connect":
          void connect(type);
          break;
        case "portal_auth":
          openPortalAuth();
          break;
        case "get_profile":
          void getProfile();
          break;
        case "open_payment":
          void openPayment(payload);
          break;
        case "open_external_url":
          openExternalUrl(payload);
          break;
        case "popup_auth":
          void openPopup(payload);
          break;
        case "set_fullscreen":
          run(function() {
            client2.setFullscreen(!!payload.enabled);
          });
          break;
        case "set_theater_mode":
          run(function() {
            client2.setTheaterMode(!!payload.enabled);
          });
          break;
        case "open_age_verification":
          run(function() {
            client2.openAgeVerification({ adultMode: payload.adultMode !== false });
          });
          break;
        default:
          sendError(
            makeError(ErrorCodes.INVALID_PAYLOAD, "Unknown Unity event: " + type)
          );
      }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      for (var i = 0; i < unsubscribers.length; i += 1) {
        unsubscribers[i]();
      }
      unsubscribers = [];
    }
    return { receive, destroy };
  }

  // src/index.js
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
        pendingUnityEvents.push({ type, payloadJson });
        return;
      }
      bridge.receive(type, payloadJson);
    },
    detach: function() {
      if (bridge) bridge.destroy();
      bridge = null;
    }
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
      debug: config.debug
    };
    var result = coreInit(coreConfig);
    if (config.gameInstance) {
      unity.attach({
        gameInstance: config.gameInstance,
        objectName: config.unityObjectName,
        methodName: config.unityMethodName
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
      enumerable: true
    }
  });
  var index_default = client;

  // src/browser.js
  if (typeof window !== "undefined") {
    window.HApps = index_default;
  }
})();
