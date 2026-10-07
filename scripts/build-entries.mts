export const browserEntryPoints = {
    chat: "src/chat.ts",
    comments: "src/comments.ts",
    crtUi: "src/crtUi.tsx",
    "contracts/staticUi": "src/contracts/staticUi.tsx",
    github: "src/github.tsx",
    keyboard: "src/keyboard.ts",
    main: "src/main.ts",
    message: "src/message.tsx",
    presence: "src/presence.tsx",
    readAloud: "src/readAloud.tsx",
    reader: "src/reader.tsx",
    readerParams: "src/readerParams.ts",
    rss: "src/rss.tsx",
    socials: "src/socials.ts",
    tategaki: "src/tategaki.tsx",
    themeLoad: "src/themeLoad.ts",
    visitLogger: "src/visitLogger.ts",
    visits: "src/visits.ts"
} as const;

export type BrowserEntryName = keyof typeof browserEntryPoints;

export const browserEntryNames = Object.keys(browserEntryPoints)
    .sort((left, right) => left.localeCompare(right)) as BrowserEntryName[];
