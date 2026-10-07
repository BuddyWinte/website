import type { ReadAloudAudioTiming } from "./types.ts";

export function buildMediaSessionTitle(
  plainText: string,
  maxChars: number = 60
): readonly string[] {
  const words = plainText.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const chunks: string[] = [];
  let currentChunk = "";

  for (const word of words) {
    if (!currentChunk) {
      currentChunk = word;
      continue;
    }

    const nextChunk = currentChunk + " " + word;
    if (nextChunk.length <= maxChars) {
      currentChunk = nextChunk;
      continue;
    }

    chunks.push(currentChunk);
    currentChunk = word;
  }

  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimatedWordsPerSecond(speechRate: number): number {
  const baseWordsPerSecondAt1x = 2.6;
  const effective = baseWordsPerSecondAt1x * speechRate;
  return effective > 0 ? effective : baseWordsPerSecondAt1x;
}

export async function audioLength(audioData: ArrayBuffer): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const audioBlob = new Blob([audioData], { type: "audio/mp3" });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio();
    let settled = false;

    const cleanup = (): void => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = "";
      URL.revokeObjectURL(audioUrl);
    };

    audio.preload = "metadata";

    audio.onloadedmetadata = () => {
      if (settled) return;
      settled = true;

      const duration = Number.isFinite(audio.duration)
        ? audio.duration
        : 0;

      cleanup();

      if (duration > 0) {
        resolve(duration);
        return;
      }

      reject(new Error("Invalid audio duration"));
    };

    audio.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Could not read audio duration"));
    };

    audio.src = audioUrl;
    audio.load();
  });
}

export async function audioTiming(
  plainText: string,
  audioData: ArrayBuffer,
  speechRate: number
): Promise<ReadAloudAudioTiming> {
  const wordCount = countWords(plainText);
  const fallbackWordsPerSecond = estimatedWordsPerSecond(speechRate);

  if (wordCount <= 0) {
    return {
      wordCount: 0,
      durationSeconds: 0,
      wordsPerSecond: fallbackWordsPerSecond
    };
  }

  let durationSeconds = wordCount / fallbackWordsPerSecond;

  try {
    const measuredDuration = await audioLength(audioData);
    if (
      Number.isFinite(measuredDuration) &&
      measuredDuration > 0
    ) durationSeconds = measuredDuration;
  } catch {
    // Fall back to the speech-rate estimate.
  }

  const wordsPerSecond = durationSeconds > 0
    ? wordCount / durationSeconds
    : fallbackWordsPerSecond;

  return {
    wordCount,
    durationSeconds,
    wordsPerSecond:
      wordsPerSecond > 0
        ? wordsPerSecond
        : fallbackWordsPerSecond
  };
}

export function mediaSessionChunkDelay(
  titleChunk: string,
  wordsPerSecond: number,
  speechRate: number
): number {
  const words = countWords(titleChunk);
  const fallback = estimatedWordsPerSecond(speechRate);
  const safeWordsPerSecond =
    wordsPerSecond > 0
      ? wordsPerSecond
      : fallback;

  const delayMs = Math.round(
    (Math.max(words, 1) / safeWordsPerSecond) * 1000
  );

  return Math.max(120, delayMs);
}
