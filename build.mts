import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as esbuild from "esbuild";
import * as config from "./src/config.js";
import { browserEntryPoints } from "./scripts/build-entries.mts";

interface BuildManifest {
    version: 1;
    files: Record<string, string>;
}

interface ManifestReadResult {
    manifest: BuildManifest | null;
    reason: string | null;
}

interface BuildDecision {
    shouldBuild: boolean;
    reason: string;
}

const forceRebuild = true;
const localManifestPath = "manifest.json";
const remoteManifestUrl = config.manifestUrl;
const remoteManifestUpdateUrl = config.ManifestUpdUrl;
const remoteManifestTimeoutMs = 5000;

const require = createRequire(import.meta.url);

/**
 * @returns {Promise<string[]>}
 */
async function getSourceFiles(): Promise<string[]> {
    const allFiles = await walk("src");
    return allFiles.filter(isTrackedSourceFile).sort((left, right) => left.localeCompare(right));
}

type BuildEntryPoints = Readonly<Record<string, string>>;

/**
 * Resolves the deliberately public browser/package entry surface.
 *
 * Implementation modules are dependencies, not independent applications.
 * @param {string[]} sourceFiles
 * @returns {BuildEntryPoints}
 */
function getEntries(sourceFiles: string[]): BuildEntryPoints {
    const available = new Set(sourceFiles.map(norm));
    const missing = Object.values(browserEntryPoints)
        .map(norm)
        .filter((filePath) => !available.has(filePath));

    if (missing.length > 0) {
        throw new Error("Configured entry points do not exist: " + quoteList(missing));
    }

    return browserEntryPoints;
}

/**
 * @param {string[]} sourceFiles
 * @returns {string[]}
 */
function getTrackedFiles(sourceFiles: string[]): string[] {
    return [
        "build.mts",
        "package.json",
        "tsconfig.json",
        "tsconfig.tools.json",
        ...sourceFiles
    ].sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function sha256(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
}

/**
 * @param {string[]} files
 * @returns {Promise<BuildManifest>}
 */
async function createManifest(files: string[]): Promise<BuildManifest> {
    const entries = await Promise.all(
        files.map(async (filePath): Promise<[string, string]> => {
            return [norm(filePath), await sha256(filePath)];
        })
    );

    return {
        version: 1,
        files: Object.fromEntries(entries)
    };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * @param {unknown} value
 * @returns {value is BuildManifest}
 */
function isBuildManifest(value: unknown): value is BuildManifest {
    if (!isRecord(value)) return false;
    if (value.version !== 1) return false;
    if (!isRecord(value.files)) return false;

    return Object.values(value.files).every((fileHash) => typeof fileHash === "string");
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

/**
 * @returns {string}
 */
function resolveTscCliPath(): string {
    return require.resolve("typescript/bin/tsc");
}

/**
 * @returns {AbortController}
 */
function createTimeoutController(): AbortController {
    return new AbortController();
}

/**
 * @returns {Promise<ManifestReadResult>}
 */
async function fetchRemoteManifest(): Promise<ManifestReadResult> {
    const controller = createTimeoutController();
    const timeout = setTimeout(() => controller.abort(), remoteManifestTimeoutMs);

    try {
        const response = await fetch(remoteManifestUrl, {
            method: "GET",
            headers: {
                "accept": "application/json"
            },
            signal: controller.signal
        });

        if (!response.ok) {
            return {
                manifest: null,
                reason: `Remote manifest request failed with ${String(response.status)} ${response.statusText}`
            };
        }

        const payload: unknown = await response.json();

        if (!isBuildManifest(payload)) {
            return {
                manifest: null,
                reason: "Remote manifest response is invalid"
            };
        }

        return {
            manifest: payload,
            reason: null
        };
    } catch (error: unknown) {
        return {
            manifest: null,
            reason: `Remote manifest unavailable (${getErrorMessage(error)})`
        };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * @param {BuildManifest | null} previous
 * @param {BuildManifest} current
 * @param {string | null} manifestReadReason
 * @returns {BuildDecision}
 */
function decideBuild(
    previous: BuildManifest | null,
    current: BuildManifest,
    manifestReadReason: string | null
): BuildDecision {
    if (previous === null) {
        return {
            shouldBuild: true,
            reason: `Triggering build: ${manifestReadReason ?? "No previous manifest found"}`
        };
    }

    if (previous.version !== current.version) {
        return {
            shouldBuild: true,
            reason: `Triggering build due to manifest version change from ${String(previous.version)} to ${String(current.version)}`
        };
    }

    const previousPaths = Object.keys(previous.files).sort((left, right) => left.localeCompare(right));
    const currentPaths = Object.keys(current.files).sort((left, right) => left.localeCompare(right));

    const addedPaths = currentPaths.filter((filePath) => !(filePath in previous.files));
    if (addedPaths.length > 0) {
        return {
            shouldBuild: true,
            reason: `Triggering build due to added tracked files: ${quoteList(addedPaths)}`
        };
    }

    const removedPaths = previousPaths.filter((filePath) => !(filePath in current.files));
    if (removedPaths.length > 0) {
        return {
            shouldBuild: true,
            reason: `Triggering build due to removed tracked files: ${quoteList(removedPaths)}`
        };
    }

    const changedPaths = currentPaths.filter((filePath) => previous.files[filePath] !== current.files[filePath]);
    if (changedPaths.length > 0) {
        return {
            shouldBuild: true,
            reason: `Triggering build due to changed tracked files: ${quoteList(changedPaths)}`
        };
    }

    return {
        shouldBuild: false,
        reason: "Skipping build: identical tracked TypeScript and build-config inputs"
    };
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function quoteList(values: string[]): string {
    return values.map((value) => `"${value}"`).join(", ");
}

/**
 * @param {string} projectPath
 * @returns {void}
 */
function runTscProject(projectPath: string): void {
    execFileSync(
        process.execPath,
        [
            resolveTscCliPath(),
            "-p",
            projectPath,
            "--noEmit"
        ],
        {
            stdio: "inherit"
        }
    );
}

/**
 * @returns {void}
 */
function runTypecheck(): void {
    runTscProject("tsconfig.json");
    runTscProject("tsconfig.tools.json");
}

/**
 * @param {BuildEntryPoints} entryPoints
 * @returns {Promise<void>}
 */
async function runBuild(entryPoints: BuildEntryPoints): Promise<void> {
    const result = await esbuild.build({
        entryPoints,
        outdir: "dist",
        outbase: "src",
        bundle: true,
        splitting: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        entryNames: "[dir]/[name]",
        chunkNames: "chunks/[name]-[hash]",
        assetNames: "wasm/[name]",
        publicPath: "/dist",
        loader: {
            ".wasm": "file"
        },
        logLevel: "info",
        metafile: true
    });

    await mkdir(".build", { recursive: true });

    await writeFile(
        ".build/esbuild-meta.json",
        JSON.stringify(result.metafile, null, 2) + "\n",
        "utf8"
    );

    const analysis = await esbuild.analyzeMetafile(
        result.metafile,
        { verbose: true }
    );

    await writeFile(
        ".build/esbuild-analysis.txt",
        analysis + "\n",
        "utf8"
    );
}

/**
 * @param {BuildManifest} manifest
 * @returns {Promise<void>}
 */
async function writeLocalManifest(manifest: BuildManifest): Promise<void> {
    await writeFile(localManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * @param {BuildManifest} manifest
 * @returns {Promise<string>}
 */
async function uploadRemoteManifest(manifest: BuildManifest): Promise<string> {
    const buildKey = process.env.BUILD_KEY;

    if (typeof buildKey !== "string" || buildKey.length === 0) {
        return "Skipping remote manifest upload: BUILD_KEY is not set";
    }

    const controller = createTimeoutController();
    const timeout = setTimeout(() => controller.abort(), remoteManifestTimeoutMs);

    try {
        const response = await fetch(remoteManifestUpdateUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-build-key": buildKey
            },
            body: JSON.stringify(manifest),
            signal: controller.signal
        });

        if (!response.ok) {
            return `Remote manifest upload failed with ${String(response.status)} ${response.statusText}`;
        }

        return "Remote manifest upload complete";
    } catch (error: unknown) {
        return `Remote manifest upload failed (${getErrorMessage(error)})`;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * @returns {Promise<void>}
 */
async function main(): Promise<void> {
    await loadOptionalDotenv();

    const sourceFiles = await getSourceFiles();
    const entryPoints = getEntries(sourceFiles);

    if (Object.keys(entryPoints).length === 0) {
        throw new Error("No entry points configured.");
    }

    const trackedFiles = getTrackedFiles(sourceFiles);
    const currentManifest = await createManifest(trackedFiles);

    console.log(`[build] Tracking ${String(trackedFiles.length)} files.`);

    let decision: BuildDecision;

    if (forceRebuild) {
        decision = {
            shouldBuild: true,
            reason: "Triggering build because forceRebuild is enabled"
        };
    } else {
        const { manifest: previousManifest, reason: manifestReadReason } = await fetchRemoteManifest();
        decision = decideBuild(previousManifest, currentManifest, manifestReadReason);
    }

    if (!decision.shouldBuild) {
        console.log(`[build] ${decision.reason}.`);
        await writeLocalManifest(currentManifest);
        console.log(`[build] Local manifest refreshed: wrote ${localManifestPath}.`);
        return;
    }

    console.log(`[build] ${decision.reason}.`);
    console.log("[build] Cleaning dist.");
    await rm("dist", { recursive: true, force: true });

    console.log("[build] Running typecheck.");
    runTypecheck();

    console.log(`[build] Building ${String(Object.keys(entryPoints).length)} intentional entry points with esbuild.`);
    await runBuild(entryPoints);

    await writeLocalManifest(currentManifest);
    console.log(`[build] Build complete: wrote ${localManifestPath}.`);

    const remoteUploadResult = await uploadRemoteManifest(currentManifest);
    console.log(`[build] ${remoteUploadResult}.`);
}

await main();