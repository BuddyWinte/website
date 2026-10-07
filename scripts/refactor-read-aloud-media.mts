import { readFile, writeFile } from "node:fs/promises";

const path = "src/readAloud/controller.tsx";
let source = await readFile(path, "utf8");

function removeSequence(
  startSignature: string,
  endSignature: string
): void {
  const startSignatureIndex = source.indexOf(startSignature);
  if (startSignatureIndex < 0) {
    throw new Error("Read-aloud start signature missing: " + startSignature);
  }

  const start = source.lastIndexOf("  /**", startSignatureIndex);
  if (start < 0) {
    throw new Error("Read-aloud method doc missing: " + startSignature);
  }

  const endSignatureIndex = source.indexOf(
    endSignature,
    startSignatureIndex
  );
  if (endSignatureIndex < 0) {
    throw new Error("Read-aloud end signature missing: " + endSignature);
  }

  const end = source.lastIndexOf("  /**", endSignatureIndex);
  if (end < 0) {
    throw new Error("Read-aloud end method doc missing: " + endSignature);
  }

  source = source.slice(0, start) + source.slice(end);
}

const viewImport = `import {
  RaHelp,
  RaMenu,
  RegionProbe
} from "./views.tsx";
`;

if (!source.includes(viewImport)) {
  throw new Error("Read-aloud view import anchor missing.");
}

source = source.replace(
  viewImport,
  viewImport +
  `import {
  audioTiming,
  buildMediaSessionTitle,
  mediaSessionChunkDelay
} from "./mediaTiming.ts";
`
);

source = source.replace(
  "  ReadAloudAudioTiming,\n",
  ""
);

source = source.replace(
  "this.__buildMSTitle(plainText, 60)",
  "buildMediaSessionTitle(plainText, 60)"
);

source = source.replace(
  "const stepDelayMs = this.__getMSChunkDelay(title, wordsPerSecond);",
  `const stepDelayMs = mediaSessionChunkDelay(
        title,
        wordsPerSecond,
        state.speechRate
      );`
);

source = source.replace(
  "const timing = await this.__audioTime(speech.plainText, result.audioData);",
  `const timing = await audioTiming(
              speech.plainText,
              result.audioData,
              state.speechRate
            );`
);

removeSequence(
  "  __buildMSTitle(",
  "  async __setMSmeta("
);

removeSequence(
  "  __countWords(",
  "  __getMSChunkDelay("
);

removeSequence(
  "  __getMSChunkDelay(",
  "  async __startMSloop("
);

await writeFile(path, source, "utf8");
console.log("[refactor-read-aloud] extracted media timing engine.");
