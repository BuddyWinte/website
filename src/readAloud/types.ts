export type ReadAloudButton = Readonly<{
  icon: string;
  action: string;
}>;

export type ReadAloudButtons = Readonly<{
  play: ReadAloudButton;
  pause: ReadAloudButton;
  stop: ReadAloudButton;
  next: ReadAloudButton;
  prev: ReadAloudButton;
  restart: ReadAloudButton;
  config: ReadAloudButton;
  hide: ReadAloudButton;
  info: ReadAloudButton;
  jump: ReadAloudButton;
  help: ReadAloudButton;
}>;

export type VoiceOption = Readonly<{
  name: string;
  locale: string;
  description: string;
}>;

export type SpeechResource = Readonly<{
  speechKey: string;
  region: string;
  regionLocked: boolean;
}>;

export type ReadAloudAudioTiming = Readonly<{
  wordCount: number;
  durationSeconds: number;
  wordsPerSecond: number;
}>;

export type ReadAloudBuffer = Readonly<{
  idx: number;
  audioData: ArrayBuffer;
  timing: ReadAloudAudioTiming;
}>;

export type ReadAloudSsmlToken = Readonly<{
  ssml: string;
  fallbackText: string;
}>;

export type ReadAloudParagraphSpeech = Readonly<{
  plainText: string;
  ssmlBody: string | null;
}>;

export type ReadAloudReq = {
  key: string;
  idx: number;
  speech: ReadAloudParagraphSpeech;
  aud: ArrayBuffer | null;
  buf: ReadAloudBuffer | null;
  synth: SpeechSynthesizer | null;
  doneAud: boolean;
  doneTim: boolean;
  okAud: (audioData: ArrayBuffer | null) => void;
  noAud: (error: unknown) => void;
  okTim: (chunk: ReadAloudBuffer | null) => void;
  noTim: (error: unknown) => void;
  audP: Promise<ArrayBuffer | null>;
  timP: Promise<ReadAloudBuffer | null>;
};

export type ReadAloudState = {
  paused: boolean;
  pressed: boolean;

  currentPIdx: number;
  currentPid: string | null;
  paragraphs: HTMLElement[];

  synthesiser: SpeechSynthesizer | null;

  lastSpokenText: string;
  voiceName: string;
  speechKey: string;
  serviceRegion: string;
  speechRate: number;

  configVisible: boolean;
  menuVisible: boolean;
  jumpVisible: boolean;

  buffer: ReadAloudBuffer | null;

  currentAudio: HTMLAudioElement | null;
  currentAudioUrl: string | null;

  apiKeyVisible: boolean;
  regionUiVisible: boolean;

  MSTimer: number | null;
  MStoken: number;
  playbackToken: number;

  originalMenuDisplay?: string;
};

export type RegionProbeResult = Readonly<{
  ok: boolean;
  status: number;
}>;

export type RegionResolveReason =
  | "ok"
  | "rate_limited"
  | "not_found"
  | "locked"
  | "cached"
  | "no_key";

export type RegionResolveResult = Readonly<{
  region: string | null;
  reason: RegionResolveReason;
}>;

export type SpeechSdkNamespace = Readonly<{
  SpeechConfig: Readonly<{
    fromSubscription: (speechKey: string, serviceRegion: string) => SpeechConfig;
  }>;

  SpeechSynthesizer: new (speechConfig: SpeechConfig, audioConfig: null) => SpeechSynthesizer;

  PropertyId: Readonly<{
    SpeechSynthesisOutputFormat: number;
  }>;

  SpeechSynthesisOutputFormat: Readonly<{
    Audio16Khz32KBitRateMonoMp3: number;
  }>;

  ResultReason: Readonly<{
    SynthesizingAudioCompleted: number;
  }>;
}>;

export type SpeechConfig = {
  speechSynthesisVoiceName: string;
  setProperty: (propertyId: number, value: number) => void;
};

export type SynthesisResult = Readonly<{
  reason: number;
  errorDetails?: string;
  audioData: ArrayBuffer;
}>;

export type SpeechSynthesizer = Readonly<{
  speakSsmlAsync: (
    ssml: string,
    onSuccess: (result: SynthesisResult) => void,
    onError: (error: unknown) => void
  ) => void;

  stopSpeakingAsync?: (onStopped: () => void) => void;

  close: () => void;
}>;

declare global {
  interface Window {
    SpeechSDK?: SpeechSdkNamespace;
    _speechSDKReadyPromise?: Promise<SpeechSdkNamespace> | null;
    readAloudState: ReadAloudState;
  }
}

