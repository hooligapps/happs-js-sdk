var ALLOWED_PLATFORM_MESSAGES = Object.freeze({
  platform_launch: true,
  auth_complete: true,
  payment_complete: true,
  profile_updated: true,
});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidUserData(value) {
  return (
    isObject(value) &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    typeof value.verified === "boolean"
  );
}

export function validatePlatformMessage(data) {
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
    if (data.signature !== undefined && typeof data.signature !== "string") {
      return "auth_complete signature must be a string";
    }
    if (data.token !== undefined && typeof data.token !== "string") {
      return "auth_complete token must be a string";
    }
    if (data.userData !== undefined && !isValidUserData(data.userData)) {
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

export function extractSignature(data) {
  if (data && typeof data.signature === "string") return data.signature;
  if (data && typeof data.token === "string") return data.token;
  return null;
}

export function extractUser(data) {
  if (!data || !isValidUserData(data.userData)) return null;
  return {
    userId: String(data.userData.id),
    userName:
      typeof data.userData.userName === "string"
        ? data.userData.userName
        : undefined,
    verified: data.userData.verified,
  };
}
