;(function(window) {
  "use strict";

  var SDK_VERSION = "1.0.3-debug";

  var ErrorCodes = {
    LOGIN_FAILED: "LOGIN_FAILED",
    INVALID_CONFIG: "INVALID_CONFIG",
    NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
    INVALID_PAYLOAD: "INVALID_PAYLOAD",
    NETWORK_ERROR: "NETWORK_ERROR",
    ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  };

  function makeError(code, message) {
    return { code: code, message: message };
  }

  var _config = null;
  var _launchToken = null;
  var _userData = null;
  var _signatureData = null;
  var _unityInstance = null;
  var _isReady = false;
  var _isPortal = false;
  var _isLoggingIn = false;
  var _initialized = false;
  var _pendingQueue = [];
  var _eventListeners = {};
  var _activePayment = null;
  var _activeAuthPopup = null;
  var _readyResolve = null;
  var _readyReject = null;

  var _defaults = {
    platformOrigin: "https://portal.igra.rocks",
    ssoLoginUrl: "/api/sign",
    unityObjectName: "HAppsManager",
    unityMethodName: "OnHAppsMessage",
    isPortal: true,
    maxRetries: 3,
    retryDelayMs: 1000,
  };

  var _allowedPlatformMessages = {
    platform_launch: true,
    auth_complete: true,
    payment_complete: true,
    profile_updated: true,
  };

  function _validateMessage(data) {
    if (!data || typeof data !== "object") return "Message is not an object";
    if (typeof data.type !== "string") return "Message type is not a string";
    if (!_allowedPlatformMessages[data.type]) return "Unknown message type: " + data.type;

    if (data.type === "platform_launch") {
      var signature = typeof data.signature === "string" ? data.signature : data.token;
      if (typeof signature !== "string") return "platform_launch requires signature string";
      if (!data.userData || typeof data.userData !== "object") return "platform_launch requires userData object";
      if (typeof data.userData.id !== "string" && typeof data.userData.id !== "number") {
        return "platform_launch userData.id is required";
      }
      if (typeof data.userData.verified !== "boolean") {
        return "platform_launch userData.verified must be boolean";
      }
    }

    return null;
  }

  function log() {
    if (typeof console !== "undefined" && console.log) {
      var args = ["[HApps:DEBUG]"];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      console.log.apply(console, args);
    }
  }

  function _emit(eventType, data) {
    var listeners = (_eventListeners[eventType] || []).slice();
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](data);
      } catch (e) {
        log("Event listener error (" + eventType + "):", e);
      }
    }
  }

  function _enqueue(type, payload) {
    log("Queued event (not authenticated yet):", type);
    _pendingQueue.push({ type: type, payload: payload });
  }

  function _flushQueue() {
    if (!_pendingQueue.length) return;

    log("Flushing queued events:", _pendingQueue.length);
    var queue = _pendingQueue.slice();
    _pendingQueue = [];

    for (var i = 0; i < queue.length; i++) {
      HApps.onUnityEvent(queue[i].type, JSON.stringify(queue[i].payload));
    }
  }

  function _sendToUnity(messageObj) {
    // Always emit for JS listeners
    _emit(messageObj.type, messageObj);

    if (!_unityInstance || !_unityInstance.SendMessage) {
      log("Unity not ready, skipped:", messageObj.type);
      return;
    }

    var msgStr = JSON.stringify(messageObj);
    log("→ Unity:", messageObj.type);
    _unityInstance.SendMessage(_config.unityObjectName, _config.unityMethodName, msgStr);
  }

  function _sendConnectToUnity(type) {
    if (!_isReady || !_userData) {
      log(
        "Cannot send connect to Unity:",
        "type=" + type,
        "isReady=" + _isReady,
        "hasUserData=" + !!_userData,
        "userData=", _userData,
      );
      return;
    }

    var message = {
      type: type,
      userData: _userData,
      signatureData: _signatureData,
      initData: {
        ready: true,
        fromPlatform: true,
      },
    };

    _sendToUnity(message);
  }

  function _handleGetProfileFromUnity() {
    if (!_userData) {
      log("No userData available for getProfile");
      _sendToUnity({
        type: "profile",
        error: makeError(ErrorCodes.NOT_AUTHENTICATED, "User not authenticated"),
      });
      return;
    }

    _sendToUnity({
      type: "profile",
      userData: _userData,
    });
  }

  function _handleOpenPaymentFromUnity(payload) {
    if (_activePayment) {
      log("Open payment rejected: payment already in progress");
      _sendToUnity({
        type: "payment",
        paymentData: { status: "fail", error: "payment_in_progress" },
      });
      return;
    }

    if (!payload.orderId) {
      log("Open payment rejected: invalid payload (missing orderId)");
      _sendToUnity({
        type: "payment",
        paymentData: { status: "fail", error: "invalid_payload" },
      });
      return;
    }

    _activePayment = { orderId: payload.orderId };

    _sendToUnity({
      type: "payment",
      paymentData: { status: "started", orderId: payload.orderId },
    });

    window.parent.postMessage({
      type: "open_checkout",
      orderId: payload.orderId,
    }, _config.platformOrigin);
  }

  function _handlePopupAuth(payload) {
    if (_activeAuthPopup) {
      try {
        if (!_activeAuthPopup.closed) {
          _activeAuthPopup.focus();
          log("Auth popup already open, focusing existing window");
          return;
        }
      } catch (e) {
      }
      _activeAuthPopup = null;
    }

    var url = payload && payload.url;

    if (!url || typeof url !== "string" || url.indexOf("https://") !== 0) {
      log("Auth popup URL rejected: must use https://");
      _sendToUnity({ type: "popup_auth_result", authPopupData: { flow: "cancelled" } });
      return;
    }

    var expectedOrigin = new URL(url).origin;

    var width = 440;
    var height = 630;

    var dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
    var dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;

    var windowWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
    var windowHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;

    var left = dualScreenLeft + (windowWidth - width) / 2;
    var top = dualScreenTop + (windowHeight - height) / 2;

    var popup = window.open(
      url,
      "hooligapps_auth_popup",
      "width=" + width + ",height=" + height + ",left=" + left + ",top=" + top + ",resizable=no,scrollbars=yes",
    );

    if (!popup) {
      log("Popup blocked by browser");
      _sendToUnity({ type: "popup_auth_result", authPopupData: { flow: "cancelled" } });
      return;
    }

    _activeAuthPopup = popup;

    var resolved = false;

    function resolve(result) {
      if (resolved) return;
      resolved = true;

      window.removeEventListener("message", onMessage);
      clearInterval(interval);

      try {
        popup.close();
      } catch (e) {
      }
      _activeAuthPopup = null;

      _sendToUnity(result);
    }

    function onMessage(event) {
      if (event.origin !== expectedOrigin) return;

      var data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "auth_ticket" && typeof data.ticket === "string" && data.ticket) {
        resolve({ type: "popup_auth_result", authPopupData: { flow: "ticket", ticket: data.ticket } });
      } else if (data.type === "auth_done") {
        resolve({ type: "popup_auth_result", authPopupData: { flow: "cookie" } });
      }
    }

    window.addEventListener("message", onMessage, false);

    var interval = setInterval(function() {
      var isClosed = false;
      try {
        isClosed = !popup || popup.closed;
      } catch (e) {
        return;
      }
      if (isClosed) resolve({ type: "popup_auth_result", authPopupData: { flow: "cancelled" } });
    }, 500);
  }

  function _handleSetFullscreen(payload) {
    if (!_config || !_config.platformOrigin) return;
    var enabled = !!(payload && payload.enabled);
    window.parent.postMessage({ type: "set_fullscreen", enabled: enabled }, _config.platformOrigin);
  }

  function _handleSetTheaterMode(payload) {
    if (!_config || !_config.platformOrigin) return;
    var enabled = !!(payload && payload.enabled);
    log("Theater mode requested:", enabled);
    window.parent.postMessage({ type: "set_theater_mode", enabled: enabled }, _config.platformOrigin);
  }

  function _handleOpenAgeVerification(payload) {
    if (!_config || !_config.platformOrigin) return;
    var adultMode = !payload || payload.adultMode !== false;
    log("Age verification popup requested");
    window.parent.postMessage({ type: "open_age_verification", adultMode: adultMode }, _config.platformOrigin);
  }

  function _handlePortalAuth() {
    log("Portal auth requested from Unity");

    if (_userData && _userData.verified) {
      log("User already verified, skipping portal auth");
      return;
    }

    window.parent.postMessage({ type: "open_auth" }, _config.platformOrigin);
  }

  function _extractSignature(data) {
    if (data && typeof data.signature === "string") return data.signature;
    if (data && typeof data.token === "string") return data.token;
    return null;
  }

  function _extractUserData(data) {
    if (!data || !data.userData || typeof data.userData !== "object") return null;

    return {
      userId: String(data.userData.id),
      userName: data.userData.userName || undefined,
      verified: !!data.userData.verified,
    };
  }

  function _onPlatformMessage(event) {
    if (!_config) return;

    if (event.origin !== _config.platformOrigin) {
      log("Ignored platform message: origin mismatch");
      return;
    }

    var data = event.data;

    var validationError = _validateMessage(data);
    if (validationError) {
      log("Invalid message from platform:", validationError);
      _emit("error", makeError(ErrorCodes.INVALID_PAYLOAD, validationError));
      return;
    }

    log("Platform message:", data.type);
    _isPortal = true;

    switch (data.type) {
      case "platform_launch":
        _launchToken = _extractSignature(data);
        _userData = _extractUserData(data);
        _loginWithPlatformSignature(_launchToken);
        break;

      case "auth_complete":
        var authSignature = _extractSignature(data);
        if (authSignature) {
          var authUserData = _extractUserData(data);
          if (authUserData) {
            _userData = authUserData;
          }
          _loginWithPlatformSignature(authSignature, function() {
            _sendToUnity({
              type: "auth_complete",
              userData: _userData,
              signatureData: _signatureData,
            });
          });
        } else {
          _sendToUnity({ type: "auth_complete" });
        }
        break;

      case "profile_updated":
        if (_userData && data.verified !== undefined) {
          _userData.verified = !!data.verified;
          log("userData updated: verified=" + _userData.verified);
          _sendToUnity({
            type: "user_changed",
            userData: _userData,
          });
        }
        break;

      case "payment_complete":
        if (!_activePayment) {
          log("No active payment, ignoring payment_complete");
          return;
        }
        if (data.orderId && data.orderId !== _activePayment.orderId) {
          log("payment_complete paymentId mismatch");
          return;
        }

        var paymentStatus = data.status || "fail";

        _sendToUnity({
          type: "payment_complete",
          paymentData: {
            orderId: data.orderId,
            status: paymentStatus,
          },
        });

        _activePayment = null;
        break;
    }
  }

  function _loginWithPlatformSignature(signature, onSuccess, attempt) {
    attempt = attempt || 1;

    if (_isLoggingIn) {
      log("Login already in progress, skipping");
      return;
    }

    _isLoggingIn = true;
    var maxRetries = _config.maxRetries;
    var retryDelayMs = _config.retryDelayMs;

    log("SSO login attempt " + attempt + "/" + maxRetries);

    fetch(_config.ssoLoginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: signature }),
    })
      .then(function(res) {
        if (!res.ok) {
          throw new Error("SSO login failed with status " + res.status);
        }
        return res.json();
      })
      .then(function(data) {
        if (!_userData) {
          throw new Error("Invalid platform launch: no userData");
        }

        var prevUserData = _userData;
        if (!data || typeof data !== "object" || typeof data.signature !== "string") {
          throw new Error("Invalid SSO response: expected { signature: string }");
        }
        _signatureData = { signature: data.signature };

        log("SSO login success, verified=" + _userData.verified + ", signature=" + !!_signatureData);

        _isReady = true;
        _isLoggingIn = false;

        _flushQueue();

        // Emit ready on first login
        if (!prevUserData) {
          _emit("ready", { user: _userData });
          if (_readyResolve) {
            _readyResolve({ user: _userData });
            _readyResolve = null;
            _readyReject = null;
          }
        }

        if (onSuccess) {
          onSuccess();
        }
      })
      .catch(function(err) {
        _isLoggingIn = false;
        log("SSO login error (attempt " + attempt + "):", err);

        if (attempt < maxRetries) {
          var delay = attempt * retryDelayMs;
          log("Retrying in " + delay + "ms...");
          setTimeout(function() {
            _loginWithPlatformSignature(signature, onSuccess, attempt + 1);
          }, delay);
        } else {
          log("SSO login failed after " + maxRetries + " attempts");
          var error = makeError(ErrorCodes.LOGIN_FAILED, String(err));
          _emit("error", error);
          if (_readyReject) {
            _readyReject(error);
            _readyResolve = null;
            _readyReject = null;
          }
        }
      });
  }

  function _cleanup() {
    window.removeEventListener("message", _onPlatformMessage, false);

    _config = null;
    _launchToken = null;
    _userData = null;
    _signatureData = null;
    _unityInstance = null;
    _isReady = false;
    _isLoggingIn = false;
    _isPortal = false;
    _initialized = false;
    _activePayment = null;
    _pendingQueue = [];
    _eventListeners = {};
    _readyResolve = null;
    _readyReject = null;
  }

  var HApps = {
    ErrorCodes: ErrorCodes,

    /**
     * Initialize the SDK
     * @param {Object} cfg - Configuration object
     * @returns {{ ready: Promise<{user: Object}> }}
     */
    init: function(cfg) {
      if (_initialized) {
        log("Init rejected: SDK already initialized");
        throw makeError(ErrorCodes.ALREADY_INITIALIZED, "HApps.init() has already been called. Use destroy() first to reinitialize.");
      }

      cfg = cfg || {};

      if (!cfg.platformOrigin) {
        log("Init rejected: missing platformOrigin");
        throw makeError(ErrorCodes.INVALID_CONFIG, "platformOrigin is required in config");
      }

      _config = {};
      var keys = Object.keys(_defaults);
      for (var i = 0; i < keys.length; i++) {
        _config[keys[i]] = cfg.hasOwnProperty(keys[i]) ? cfg[keys[i]] : _defaults[keys[i]];
      }

      if (cfg.gameInstance) {
        _unityInstance = cfg.gameInstance;
      }

      _isPortal = !!_config.isPortal;
      _initialized = true;

      log("SDK v" + SDK_VERSION + " initialized");

      window.addEventListener("message", _onPlatformMessage, false);

      var readyPromise = _isPortal
        ? new Promise(function(resolve, reject) {
            _readyResolve = resolve;
            _readyReject = reject;
          })
        : Promise.resolve({ user: null });

      if (_isPortal) {
        window.parent.postMessage({
          type: "sdk_ready",
          sdkVersion: SDK_VERSION,
          capabilities: ["get_profile", "open_payment", "popup_auth", "portal_auth", "open_age_verification", "set_theater_mode"]
        }, _config.platformOrigin);

        window.parent.postMessage({ type: "request_launch_token" }, _config.platformOrigin);
      }

      return { ready: readyPromise };
    },

    /**
     * Subscribe to SDK events
     * Events: init, ready, profile, auth_complete, user_changed, payment_complete, auth_ticket, error
     * @param {string} eventType
     * @param {Function} callback
     */
    on: function(eventType, callback) {
      if (!_eventListeners[eventType]) {
        _eventListeners[eventType] = [];
      }
      _eventListeners[eventType].push(callback);
    },

    /**
     * Subscribe to an SDK event once (auto-unsubscribes after first call)
     * @param {string} eventType
     * @param {Function} callback
     */
    once: function(eventType, callback) {
      function wrapper(data) {
        HApps.off(eventType, wrapper);
        callback(data);
      }

      HApps.on(eventType, wrapper);
    },

    /**
     * Unsubscribe from SDK events
     * @param {string} eventType
     * @param {Function} callback
     */
    off: function(eventType, callback) {
      var listeners = _eventListeners[eventType];
      if (!listeners) return;
      _eventListeners[eventType] = listeners.filter(function(fn) {
        return fn !== callback;
      });
    },

    /**
     * Get current user data
     * @returns {Object|null}
     */
    getUser: function() {
      return _userData ? {
        userId: _userData.userId,
        userName: _userData.userName,
        verified: _userData.verified,
      } : null;
    },

    /**
     * Check if SDK is authenticated and ready
     * @returns {boolean}
     */
    isReady: function() {
      return _isReady;
    },

    /**
     * Check if SDK is running inside portal
     * @returns {boolean}
     */
    isPortal: function() {
      return _isPortal;
    },

    /**
     * Get SDK version
     * @returns {string}
     */
    getVersion: function() {
      return SDK_VERSION;
    },

    /**
     * Request portal auth (for JS/HTML5 games without Unity)
     */
    requestAuth: function() {
      _handlePortalAuth();
    },

    /**
     * Request portal fullscreen mode (hide portal chrome around iframe)
     * @param {boolean} enabled
     */
    setFullscreen: function(enabled) {
      _handleSetFullscreen({ enabled: !!enabled });
    },

    /**
     * Request portal theater mode (make iframe fill available width/height)
     * @param {boolean} enabled
     */
    setTheaterMode: function(enabled) {
      _handleSetTheaterMode({ enabled: !!enabled });
    },

    /**
     * Request portal age verification popup
     */
    openAgeVerification: function(payload) {
      _handleOpenAgeVerification(payload);
    },

    /**
     * Cleanup all listeners and reset state
     */
    destroy: function() {
      log("Destroying HApps SDK");
      _cleanup();
    },

    /**
     * Called from Unity via jslib / SendMessage bridge
     * @param {string} type - Event type (e.g. 'init', 'register', 'profile')
     * @param {string} payloadJson - JSON string payload
     */
    onUnityEvent: function(type, payloadJson) {
      log("← Unity:", type);

      var payload = {};
      try {
        if (payloadJson) {
          payload = JSON.parse(payloadJson);
        }
      } catch (e) {
        log("Failed to parse unity payload JSON", e);
        _emit("error", makeError(ErrorCodes.INVALID_PAYLOAD, "Failed to parse Unity payload: " + String(e)));
        return;
      }

      // Queue all events except "init", "popup_auth", and "open_age_verification" if not authenticated yet
      if (!_isReady && type !== "init" && type !== "popup_auth" && type !== "open_age_verification") {
        _enqueue(type, payload);
        return;
      }

      log("Dispatch Unity event:", type);

      switch (type) {
        case "init":
        case "connect":
          _sendConnectToUnity(type);
          break;
        case "portal_auth":
          _handlePortalAuth();
          break;
        case "get_profile":
          _handleGetProfileFromUnity();
          break;
        case "open_payment":
          _handleOpenPaymentFromUnity(payload);
          break;
        case "popup_auth":
          _handlePopupAuth(payload);
          break;
        case "set_theater_mode":
          _handleSetTheaterMode(payload);
          break;
        case "open_age_verification":
          _handleOpenAgeVerification(payload);
          break;
        default:
          log("Unknown Unity event type:", type);
      }
    },
  };

  window.HApps = HApps;
})(window);
