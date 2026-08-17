declare interface UserData {
  userId: string;
  userName?: string;
  verified: boolean;
}

declare interface SignatureData {
  signature: string;
}

declare interface HAppsError {
  code: string;
  message: string;
}

declare interface InitConfig {
  platformOrigin: string;
  ssoLoginUrl: string;
  gameInstance?: any;
  unityObjectName?: string;
  unityMethodName?: string;
  isPortal?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

declare interface InitResult {
  ready: Promise<{ user: UserData | null }>;
}

declare interface EventMap {
  init: {
    type: "init";
    userData: UserData;
    signatureData: SignatureData | null;
    initData: { ready: boolean; fromPlatform: boolean };
  };
  connect: {
    type: "connect";
    userData: UserData;
    signatureData: SignatureData | null;
    initData: { ready: boolean; fromPlatform: boolean };
  };
  ready: { user: UserData };
  profile: { type: "profile"; userData?: UserData; error?: HAppsError };
  auth_complete: { type: "auth_complete"; userData?: UserData; signatureData?: SignatureData | null };
  user_changed: UserData;
  payment: { type: "payment"; paymentData: { status: string; orderId?: string; error?: string } };
  payment_complete: { type: "payment_complete"; paymentData: { orderId?: string; status: string } };
  popup_auth_result:
    | { type: "popup_auth_result"; authPopupData: { flow: "ticket"; ticket: string } }
    | { type: "popup_auth_result"; authPopupData: { flow: "cookie" } }
    | { type: "popup_auth_result"; authPopupData: { flow: "cancelled" } };
  error: HAppsError;
}

declare interface ErrorCodesMap {
  LOGIN_FAILED: "LOGIN_FAILED";
  INVALID_CONFIG: "INVALID_CONFIG";
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED";
  INVALID_PAYLOAD: "INVALID_PAYLOAD";
  NETWORK_ERROR: "NETWORK_ERROR";
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED";
}

declare interface HAppsSDK {
  ErrorCodes: ErrorCodesMap;

  init(config: InitConfig): InitResult;

  on<K extends keyof EventMap>(event: K, callback: (data: EventMap[K]) => void): void;
  once<K extends keyof EventMap>(event: K, callback: (data: EventMap[K]) => void): void;
  off<K extends keyof EventMap>(event: K, callback: (data: EventMap[K]) => void): void;

  getUser(): UserData | null;
  isReady(): boolean;
  isPortal(): boolean;
  getVersion(): string;
  requestAuth(): void;
  setFullscreen(enabled: boolean): void;
  setTheaterMode(enabled: boolean): void;
  openAgeVerification(payload?: { adultMode?: boolean }): void;
  destroy(): void;

  onUnityEvent(type: string, payloadJson: string): void;
}

declare var HApps: HAppsSDK;
