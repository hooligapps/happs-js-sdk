export interface HAppsUser {
  id: string;
  userId?: string;
  userName?: string;
  verified: boolean;
}

export interface HAppsConnection {
  user: HAppsUser | null;
  signature: string | null;
  ssoData: unknown | null;
}

export interface HAppsSignatureData {
  signature: string;
}

export interface HAppsError {
  code: string;
  message: string;
}

export interface HAppsInitConfig {
  platformOrigin: string;
  ssoLoginUrl?: string;
  isPortal?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  operationTimeoutMs?: number;
  debug?: boolean;
}

export interface HAppsInitResult {
  ready: Promise<HAppsConnection>;
}

export type HAppsAuthPopupResult =
  | { flow: "ticket"; ticket: string; payload?: unknown }
  | { flow: "cookie"; payload?: unknown }
  | { flow: "cancelled" };

export interface HAppsPaymentResult {
  orderId: string;
  status: string;
}

export interface HAppsEventMap {
  ready: HAppsConnection;
  auth_complete: {
    type: "auth_complete";
    userData?: HAppsUser;
    signatureData?: HAppsSignatureData | null;
  };
  user_changed: { type: "user_changed"; userData: HAppsUser };
  payment: {
    type: "payment";
    paymentData: { status: string; orderId?: string; error?: string };
  };
  payment_complete: {
    type: "payment_complete";
    paymentData: HAppsPaymentResult;
  };
  popup_auth_result: {
    type: "popup_auth_result";
    authPopupData: HAppsAuthPopupResult;
  };
  error: HAppsError;
}

export interface HAppsErrorCodes {
  readonly LOGIN_FAILED: "LOGIN_FAILED";
  readonly INVALID_CONFIG: "INVALID_CONFIG";
  readonly NOT_AUTHENTICATED: "NOT_AUTHENTICATED";
  readonly INVALID_PAYLOAD: "INVALID_PAYLOAD";
  readonly NETWORK_ERROR: "NETWORK_ERROR";
  readonly ALREADY_INITIALIZED: "ALREADY_INITIALIZED";
  readonly NOT_INITIALIZED: "NOT_INITIALIZED";
  readonly NOT_IN_PORTAL: "NOT_IN_PORTAL";
  readonly OPERATION_IN_PROGRESS: "OPERATION_IN_PROGRESS";
  readonly OPERATION_TIMEOUT: "OPERATION_TIMEOUT";
}

export type HAppsUnsubscribe = () => void;

export interface HAppsClient {
  readonly ErrorCodes: HAppsErrorCodes;

  init(config: HAppsInitConfig): HAppsInitResult;
  connect(): Promise<HAppsConnection>;

  on<K extends keyof HAppsEventMap>(
    event: K,
    callback: (data: HAppsEventMap[K]) => void,
  ): HAppsUnsubscribe;
  once<K extends keyof HAppsEventMap>(
    event: K,
    callback: (data: HAppsEventMap[K]) => void,
  ): HAppsUnsubscribe;
  off<K extends keyof HAppsEventMap>(
    event: K,
    callback: (data: HAppsEventMap[K]) => void,
  ): void;

  getUser(): HAppsUser | null;
  getSignature(): string | null;
  getProfile(): Promise<HAppsUser | null>;
  isReady(): boolean;
  isPortal(): boolean;
  getVersion(): string;

  requestAuth(): void;
  openPortalAuth(): Promise<HAppsConnection>;
  openIdpAuthPopup(
    url: string,
    callbackOrigin?: string,
  ): Promise<HAppsAuthPopupResult>;
  openPayment(orderId: string): Promise<HAppsPaymentResult>;
  openExternalUrl(url: string): void;
  setFullscreen(enabled: boolean): void;
  setTheaterMode(enabled: boolean): void;
  openAgeVerification(payload?: { adultMode?: boolean }): void;
  destroy(): void;
}

export interface HAppsUnityInstance {
  SendMessage(objectName: string, methodName: string, message: string): void;
}

export interface HAppsUnityConfig {
  gameInstance: HAppsUnityInstance;
  objectName?: string;
  methodName?: string;
}

export interface HAppsUnityBridge {
  receive(type: string, payloadJson?: string): void;
  destroy(): void;
}

export interface HAppsUnityFacade {
  attach(config: HAppsUnityConfig): HAppsUnityBridge;
  receive(type: string, payloadJson?: string): void;
  detach(): void;
}

export interface HAppsBrowserInitConfig extends HAppsInitConfig {
  /** @deprecated Prefer HApps.unity.attach(). */
  gameInstance?: HAppsUnityInstance;
  /** @deprecated Prefer HApps.unity.attach(). */
  unityObjectName?: string;
  /** @deprecated Prefer HApps.unity.attach(). */
  unityMethodName?: string;
}

export interface HAppsSDK extends Omit<HAppsClient, "init"> {
  init(config: HAppsBrowserInitConfig): HAppsInitResult;
  readonly unity: HAppsUnityFacade;
  /** @deprecated Use HApps.unity.receive(). */
  onUnityEvent(type: string, payloadJson?: string): void;
}

export declare function createHAppsClient(
  config?: HAppsInitConfig,
): HAppsClient;
export declare const createUnityBridge: (
  client: HAppsClient,
  config: HAppsUnityConfig,
) => HAppsUnityBridge;
export declare const ErrorCodes: HAppsErrorCodes;
export declare const SDK_VERSION: string;
export declare const HApps: HAppsSDK;
export default HApps;

declare global {
  interface Window {
    HApps: HAppsSDK;
  }
}
