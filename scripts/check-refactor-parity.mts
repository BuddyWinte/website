import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { browserEntryNames } from "./build-entries.mjs";

const baselineRoot = resolve(process.argv[2] ?? ".baseline");
const candidateRoot = process.cwd();

async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry): Promise<string[]> => {
            const path = join(dir, entry.name);
            return entry.isDirectory() ? walk(path) : [path];
        })
    );

    return nested.flat();
}

function posix(path: string): string {
    return path.split(sep).join("/");
}

async function hash(path: string): Promise<string> {
    return createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
}

function isComparableSiteFile(path: string): boolean {
    if (path === "manifest.json") return false;
    if (path.startsWith("dist/")) return false;
    return true;
}

async function siteMap(root: string): Promise<Map<string, string>> {
    const site = resolve(root, "site");
    const files = await walk(site);
    const map = new Map<string, string>();

    for (const file of files) {
        const relativePath = posix(relative(site, file));
        if (!isComparableSiteFile(relativePath)) continue;
        map.set(relativePath, await hash(file));
    }

    return map;
}

function exportedNames(source: string): string[] {
    const names = new Set<string>();

    for (const block of source.matchAll(/export\s*\{([\s\S]*?)\};/g)) {
        const body = block[1] ?? "";

        for (const part of body.split(",")) {
            const item = part.trim();
            if (!item) continue;

            const alias = item.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
            names.add(alias?.[1] ?? item.replace(/\s+/g, ""));
        }
    }

    if (/export\s+default\b/.test(source)) names.add("default");

    return [...names].sort((left, right) => left.localeCompare(right));
}

const baselineSite = await siteMap(baselineRoot);
const candidateSite = await siteMap(candidateRoot);
const failures: string[] = [];

const allSitePaths = new Set([
    ...baselineSite.keys(),
    ...candidateSite.keys()
]);

for (const path of [...allSitePaths].sort((left, right) => left.localeCompare(right))) {
    if (!baselineSite.has(path)) {
        failures.push("Candidate added non-dist site file: " + path);
        continue;
    }

    if (!candidateSite.has(path)) {
        failures.push("Candidate removed non-dist site file: " + path);
        continue;
    }

    if (baselineSite.get(path) === candidateSite.get(path)) continue;
    failures.push("Non-dist site file changed: " + path);
}

for (const entry of browserEntryNames) {
    const relativePath = "dist/" + entry + ".js";
    const baselinePath = resolve(baselineRoot, relativePath);
    const candidatePath = resolve(candidateRoot, relativePath);

    let baselineSource: string;
    let candidateSource: string;

    try {
        baselineSource = await readFile(baselinePath, "utf8");
        candidateSource = await readFile(candidatePath, "utf8");
    } catch {
        failures.push(
            "Missing public entry in baseline or candidate: " +
            relativePath
        );
        continue;
    }

    const baselineExports = exportedNames(baselineSource);
    const candidateExports = exportedNames(candidateSource);

    if (JSON.stringify(baselineExports) === JSON.stringify(candidateExports)) continue;

    failures.push(
        "Public export surface changed for " +
        relativePath +
        ": " +
        baselineExports.join(", ") +
        " -> " +
        candidateExports.join(", ")
    );
}

for (const failure of failures) {
    console.error("[parity] " + failure);
}

if (failures.length > 0) {
    process.exitCode = 1;
} else {
    console.log(
        "[parity] Static site output and " +
        String(browserEntryNames.length) +
        " public entry export surfaces match baseline."
    );
}
