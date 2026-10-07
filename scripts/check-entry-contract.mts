import { readdir, readFile } from "node:fs/promises";
import { browserEntryNames, browserEntryPoints } from "./build-entries.mts";

const htmlFiles = (await readdir("."))
    .filter((path) => path.endsWith(".html"))
    .sort((left, right) => left.localeCompare(right));

const referenced = new Set<string>();
const pattern = /(?:\.\.\/|\.\/|\/)dist\/([A-Za-z0-9_/-]+)\.js/g;

for (const path of htmlFiles) {
    const html = await readFile(path, "utf8");

    for (const match of html.matchAll(pattern)) {
        if (!match[1]) continue;
        referenced.add(match[1]);
    }
}

const configured = new Set<string>(browserEntryNames);
const missing = [...referenced]
    .filter((entry) => !configured.has(entry))
    .sort((left, right) => left.localeCompare(right));

const compatibility = new Map<string, string>([
    ["keyboard", "src/keyboard.ts"],
    ["contracts/staticUi", "src/contracts/staticUi.tsx"]
]);

const compatibilityFailures: string[] = [];
for (const [name, source] of compatibility) {
    const configuredSource =
        browserEntryPoints[name as keyof typeof browserEntryPoints];

    if (configuredSource === source) continue;
    compatibilityFailures.push(name + " must remain mapped to " + source);
}

if (missing.length > 0) {
    console.error(
        "[entries] HTML references unconfigured dist entries: " +
        missing.join(", ")
    );
}

for (const failure of compatibilityFailures) {
    console.error("[entries] " + failure);
}

if (missing.length > 0 || compatibilityFailures.length > 0) {
    process.exitCode = 1;
} else {
    console.log(
        "[entries] " +
        String(referenced.size) +
        " HTML entries and " +
        String(compatibility.size) +
        " compatibility entries are covered by the explicit build manifest."
    );
}
