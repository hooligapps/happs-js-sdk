import { ErrorCodes, makeError, normalizeError } from "./errors.js";

export function createUnityBridge(client, bridgeConfig) {
  if (!client || typeof client.connect !== "function") {
    throw new TypeError("A HApps client instance is required");
  }
  if (
    !bridgeConfig ||
    !bridgeConfig.gameInstance ||
    typeof bridgeConfig.gameInstance.SendMessage !== "function"
  ) {
    throw new TypeError("gameInstance.SendMessage is required");
  }

  var gameInstance = bridgeConfig.gameInstance;
  var objectName = bridgeConfig.objectName || "HAppsJSBridge";
  var methodName = bridgeConfig.methodName || "OnMessage";
  var destroyed = false;
  var unsubscribers = [
    client.on("auth_complete", send),
    client.on("user_changed", send),
    client.on("payment", send),
    client.on("payment_complete", send),
    client.on("popup_auth_result", send),
    client.on("error", function(error) {
      send({ type: "error", error: error });
    }),
  ];

  function send(message) {
    if (destroyed) return;
    gameInstance.SendMessage(
      objectName,
      methodName,
      JSON.stringify(message),
    );
  }

  function sendError(error) {
    send({ type: "error", error: normalizeError(error) });
  }

  async function connect(type) {
    try {
      var connection = await client.connect();
      if (!connection.user) {
        sendError(
          makeError(ErrorCodes.NOT_AUTHENTICATED, "User not authenticated"),
        );
        return;
      }
      send({
        type: type,
        userData: connection.user,
        signatureData: connection.signature
          ? { signature: connection.signature }
          : null,
        initData: { ready: true, fromPlatform: true },
      });
    } catch (error) {
      var normalized = normalizeError(error);
      if (
        normalized.code !== ErrorCodes.LOGIN_FAILED &&
        normalized.code !== ErrorCodes.OPERATION_TIMEOUT
      ) {
        sendError(normalized);
      }
    }
  }

  async function getProfile() {
    try {
      var user = await client.getProfile();
      if (!user) {
        send({
          type: "profile",
          error: makeError(
            ErrorCodes.NOT_AUTHENTICATED,
            "User not authenticated",
          ),
        });
        return;
      }
      send({ type: "profile", userData: user });
    } catch (error) {
      send({ type: "profile", error: normalizeError(error) });
    }
  }

  function openPortalAuth() {
    var user = client.getUser();
    if (user && user.verified) {
      var signature = client.getSignature();
      send({
        type: "auth_complete",
        userData: user,
        signatureData: signature ? { signature: signature } : null,
      });
      return;
    }
    run(client.requestAuth);
  }

  async function openPayment(payload) {
    if (typeof payload.orderId !== "string" || !payload.orderId) {
      send({
        type: "payment",
        paymentData: { status: "fail", error: "invalid_payload" },
      });
      return;
    }
    try {
      await client.openPayment(payload.orderId);
    } catch (error) {
      var normalized = normalizeError(error);
      if (normalized.code === ErrorCodes.OPERATION_TIMEOUT) return;
      send({
        type: "payment",
        paymentData: {
          status: "fail",
          orderId: payload.orderId,
          error: normalized.code.toLowerCase(),
        },
      });
    }
  }

  async function openPopup(payload) {
    if (typeof payload.url !== "string" || !payload.url) {
      send({
        type: "popup_auth_result",
        authPopupData: { flow: "cancelled" },
      });
      return;
    }
    try {
      await client.openIdpAuthPopup(
        payload.url,
        typeof payload.callbackOrigin === "string"
          ? payload.callbackOrigin
          : undefined,
      );
    } catch (error) {
      sendError(error);
    }
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
          "Failed to parse Unity payload: " + normalizeError(error).message,
        ),
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
      case "popup_auth":
        void openPopup(payload);
        break;
      case "set_fullscreen":
        run(function() {
          client.setFullscreen(!!payload.enabled);
        });
        break;
      case "set_theater_mode":
        run(function() {
          client.setTheaterMode(!!payload.enabled);
        });
        break;
      case "open_age_verification":
        run(function() {
          client.openAgeVerification({ adultMode: payload.adultMode !== false });
        });
        break;
      default:
        sendError(
          makeError(ErrorCodes.INVALID_PAYLOAD, "Unknown Unity event: " + type),
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

  return { receive: receive, destroy: destroy };
}
