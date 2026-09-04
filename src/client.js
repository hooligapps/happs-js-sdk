import { ErrorCodes, getErrorMessage, makeError } from "./errors.js";
import { createEmitter } from "./emitter.js";
import {
  extractSignature,
  extractUser,
  validatePlatformMessage,
} from "./protocol.js";
import { createPortalTransport } from "./portal-transport.js";

export const SDK_VERSION = "1.1.1";

var DEFAULTS = Object.freeze({
  ssoLoginUrl: "/api/sign",
  isPortal: true,
  maxRetries: 3,
  retryDelayMs: 1000,
  operationTimeoutMs: 180000,
  debug: false,
});

function wait(delayMs) {
  return new Promise(function(resolve) {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export function createHAppsClient(initialConfig) {
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
        "Call HApps.init() before using the SDK",
      );
    }
  }

  function getConnection() {
    return {
      user: HApps.getUser(),
      signature: HApps.getSignature(),
    };
  }

  function postToPortal(message) {
    requireInitialized();
    if (!isPortal) {
      throw makeError(
        ErrorCodes.NOT_IN_PORTAL,
        "This operation is available only inside the portal",
      );
    }
    transport.post(message);
  }

  function waitForEvent(eventType, startAction) {
    return new Promise(function(resolve, reject) {
      var unsubscribe = function() {};
      var timeoutId = browserWindow.setTimeout(function() {
        unsubscribe();
        reject(
          makeError(
            ErrorCodes.OPERATION_TIMEOUT,
            eventType + " did not complete before timeout",
          ),
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
          body: JSON.stringify({ token: signature }),
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
            userData: connection.user || undefined,
            signatureData: signatureData,
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
          getErrorMessage(error),
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
        makeError(ErrorCodes.INVALID_PAYLOAD, validationError),
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
          id: userData.id,
          userId: userData.userId,
          userName: userData.userName,
          verified: data.verified,
        };
        emitter.emit("user_changed", {
          type: "user_changed",
          userData: HApps.getUser(),
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
          paymentData: paymentData,
        });
        payment.resolve(paymentData);
        break;
      }
    }
  }

  function init(cfg) {
    if (initialized) {
      throw makeError(
        ErrorCodes.ALREADY_INITIALIZED,
        "HApps.init() has already been called. Use destroy() first to reinitialize.",
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
        "platformOrigin must be a valid URL",
      );
    }
    if (platformUrl.protocol !== "https:" && platformUrl.protocol !== "http:") {
      throw makeError(
        ErrorCodes.INVALID_CONFIG,
        "platformOrigin must use http or https",
      );
    }

    var maxRetries = cfg.maxRetries ?? DEFAULTS.maxRetries;
    var retryDelayMs = cfg.retryDelayMs ?? DEFAULTS.retryDelayMs;
    var operationTimeoutMs =
      cfg.operationTimeoutMs ?? DEFAULTS.operationTimeoutMs;
    if (!Number.isInteger(maxRetries) || maxRetries < 1) {
      throw makeError(
        ErrorCodes.INVALID_CONFIG,
        "maxRetries must be a positive integer",
      );
    }
    if (retryDelayMs < 0 || operationTimeoutMs <= 0) {
      throw makeError(
        ErrorCodes.INVALID_CONFIG,
        "Timeout values must be positive",
      );
    }

    browserWindow = window;
    config = {
      platformOrigin: platformUrl.origin,
      ssoLoginUrl: cfg.ssoLoginUrl ?? DEFAULTS.ssoLoginUrl,
      isPortal: cfg.isPortal ?? DEFAULTS.isPortal,
      maxRetries: maxRetries,
      retryDelayMs: retryDelayMs,
      operationTimeoutMs: operationTimeoutMs,
      debug: cfg.debug ?? DEFAULTS.debug,
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
        "Portal connection did not complete before timeout",
      );
      emitter.emit("error", error);
      readyReject(error);
      readyResolve = null;
      readyReject = null;
    }, config.operationTimeoutMs);

    transport = createPortalTransport(
      browserWindow,
      config.platformOrigin,
      handlePlatformMessage,
    );
    transport.start();
    transport.post({
      type: "sdk_ready",
      sdkVersion: SDK_VERSION,
      capabilities: [
        "get_profile",
        "open_payment",
        "popup_auth",
        "portal_auth",
        "open_age_verification",
        "set_fullscreen",
        "set_theater_mode",
      ],
    });
    transport.post({ type: "request_launch_token" });
    log("Initialized", {
      version: SDK_VERSION,
      platformOrigin: config.platformOrigin,
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
          "Authentication popup is already open",
        ),
      );
    }

    function resolveImmediately(result) {
      emitter.emit("popup_auth_result", {
        type: "popup_auth_result",
        authPopupData: result,
      });
      return Promise.resolve(result);
    }

    var popupUrl;
    var callbackUrl;
    try {
      popupUrl = new URL(url, browserWindow.location.href);
      callbackUrl = callbackOrigin
        ? new URL(callbackOrigin, browserWindow.location.href)
        : popupUrl;
    } catch (_) {
      return resolveImmediately({ flow: "cancelled" });
    }
    if (
      (popupUrl.protocol !== "https:" && popupUrl.protocol !== "http:") ||
      (callbackUrl.protocol !== "https:" && callbackUrl.protocol !== "http:")
    ) {
      return resolveImmediately({ flow: "cancelled" });
    }

    var width = 440;
    var height = 630;
    var screenLeft =
      browserWindow.screenLeft !== undefined
        ? browserWindow.screenLeft
        : browserWindow.screenX;
    var screenTop =
      browserWindow.screenTop !== undefined
        ? browserWindow.screenTop
        : browserWindow.screenY;
    var windowWidth =
      browserWindow.innerWidth ||
      browserWindow.document.documentElement.clientWidth ||
      browserWindow.screen.width;
    var windowHeight =
      browserWindow.innerHeight ||
      browserWindow.document.documentElement.clientHeight ||
      browserWindow.screen.height;
    var left = screenLeft + (windowWidth - width) / 2;
    var top = screenTop + (windowHeight - height) / 2;

    var popup = browserWindow.open(
      popupUrl.toString(),
      "hooligapps_auth_popup",
      "width=" +
        width +
        ",height=" +
        height +
        ",left=" +
        left +
        ",top=" +
        top +
        ",resizable=no,scrollbars=yes",
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
        } catch (_) {}
        activeAuthPopup = null;
        cancelAuthPopup = null;
        emitter.emit("popup_auth_result", {
          type: "popup_auth_result",
          authPopupData: result,
        });
        resolve(result);
      }

      function onMessage(event) {
        if (event.origin !== expectedOrigin || event.source !== popup) return;
        var data = event.data;
        if (!data || typeof data !== "object") return;
        var payload = data.payload === undefined ? {} : { payload: data.payload };
        if (
          data.type === "auth_ticket" &&
          typeof data.ticket === "string" &&
          data.ticket
        ) {
          finish({ flow: "ticket", ticket: data.ticket, ...payload });
        } else if (data.type === "auth_done") {
          finish({ flow: "cookie", ...payload });
        }
      }

      browserWindow.addEventListener("message", onMessage, false);
      closedInterval = browserWindow.setInterval(function() {
        try {
          if (popup.closed) finish({ flow: "cancelled" });
        } catch (_) {}
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
    ErrorCodes: ErrorCodes,

    init: init,

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
      return userData
        ? {
            id: userData.id,
            userId: userData.userId,
            userName: userData.userName,
            verified: userData.verified,
          }
        : null;
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
          getConnection,
        );
      });
    },

    openIdpAuthPopup: openIdpAuthPopup,

    openPayment: async function(orderId) {
      requireInitialized();
      if (typeof orderId !== "string" || !orderId) {
        throw makeError(ErrorCodes.INVALID_PAYLOAD, "orderId is required");
      }
      await HApps.connect();
      if (!isPortal) {
        throw makeError(
          ErrorCodes.NOT_IN_PORTAL,
          "openPayment is available only inside the portal",
        );
      }
      if (activePayment) {
        throw makeError(
          ErrorCodes.OPERATION_IN_PROGRESS,
          "Payment is already in progress",
        );
      }

      return new Promise(function(resolve, reject) {
        var timeoutId = browserWindow.setTimeout(function() {
          if (!activePayment || activePayment.orderId !== orderId) return;
          activePayment = null;
          var error = makeError(
            ErrorCodes.OPERATION_TIMEOUT,
            "Payment " + orderId + " did not complete before timeout",
          );
          emitter.emit("payment", {
            type: "payment",
            paymentData: {
              status: "fail",
              orderId: orderId,
              error: "operation_timeout",
            },
          });
          reject(error);
        }, config.operationTimeoutMs);

        activePayment = {
          orderId: orderId,
          resolve: resolve,
          reject: reject,
          timeoutId: timeoutId,
        };
        emitter.emit("payment", {
          type: "payment",
          paymentData: { status: "started", orderId: orderId },
        });
        postToPortal({ type: "open_checkout", orderId: orderId });
      });
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
        adultMode: !payload || payload.adultMode !== false,
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
            "SDK was destroyed during payment",
          ),
        );
        activePayment = null;
      }
      if (!ready && readyReject) {
        readyReject(
          makeError(
            ErrorCodes.NOT_INITIALIZED,
            "SDK was destroyed before it became ready",
          ),
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
    },
  };

  if (initialConfig) HApps.init(initialConfig);
  return HApps;
}
