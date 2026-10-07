import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const baselineRef = "c0c9c0d8b909d26694087d8de9639b397e285b25";

type Violation = Readonly<{
    file: string;
    line: number;
    kind: string;
    fingerprint: string;
}>;

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

function isSource(path: string): boolean {
    if (path.endsWith(".d.ts")) return false;
    return path.endsWith(".ts") || path.endsWith(".tsx");
}

function isConditionalStatement(node: ts.Node): boolean {
    return ts.isIfStatement(node) || ts.isSwitchStatement(node);
}

function hasConditionalAncestor(node: ts.Node): boolean {
    let parent = node.parent;

    while (parent) {
        if (isConditionalStatement(parent)) return true;
        parent = parent.parent;
    }

    return false;
}

function normaliseNode(node: ts.Node, source: ts.SourceFile): string {
    return node.getText(source).replace(/\s+/g, " ").trim();
}

function fingerprint(node: ts.Node, source: ts.SourceFile): string {
    return createHash("sha256")
        .update(ts.SyntaxKind[node.kind])
        .update("\0")
        .update(normaliseNode(node, source))
        .digest("hex");
}

function scan(file: string, content: string): Violation[] {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        kind
    );
    const violations: Violation[] = [];

    const visit = (node: ts.Node): void => {
        if (isConditionalStatement(node) && hasConditionalAncestor(node)) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source));
            violations.push({
                file,
                line: position.line + 1,
                kind: ts.SyntaxKind[node.kind],
                fingerprint: fingerprint(node, source)
            });
        }

        ts.forEachChild(node, visit);
    };

    visit(source);
    return violations;
}

function baselineFiles(): string[] {
    const output = execFileSync(
        "git",
        ["ls-tree", "-r", "--name-only", baselineRef, "--", "src"],
        { encoding: "utf8" }
    );

    return output
        .split(/\r?\n/)
        .filter(Boolean)
        .filter(isSource);
}

function baselineContent(path: string): string {
    return execFileSync(
        "git",
        ["show", baselineRef + ":" + path],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
}

function counts(violations: Violation[]): Map<string, number> {
    const result = new Map<string, number>();

    for (const violation of violations) {
        result.set(
            violation.fingerprint,
            (result.get(violation.fingerprint) ?? 0) + 1
        );
    }

    return result;
}

const currentPaths = (await walk("src"))
    .filter(isSource)
    .sort((left, right) => left.localeCompare(right));

const currentViolations: Violation[] = [];
for (const path of currentPaths) {
    currentViolations.push(...scan(path, await readFile(path, "utf8")));
}

const baselineViolations = baselineFiles()
    .flatMap((path) => scan(path, baselineContent(path)));

const baselineCounts = counts(baselineViolations);
const currentCounts = counts(currentViolations);
const regressionFingerprints = new Set<string>();

for (const violation of currentViolations) {
    const allowed = baselineCounts.get(violation.fingerprint) ?? 0;
    const present = currentCounts.get(violation.fingerprint) ?? 0;
    if (present <= allowed) continue;
    regressionFingerprints.add(violation.fingerprint);
}

if (regressionFingerprints.size > 0) {
    console.error("[nesting] New nested conditional statements are forbidden.");

    for (const violation of currentViolations) {
        if (!regressionFingerprints.has(violation.fingerprint)) continue;
        console.error(
            "[nesting] " +
            violation.file +
            ":" +
            String(violation.line) +
            " " +
            violation.kind
        );
    }

    process.exitCode = 1;
} else {
    console.log(
        "[nesting] No new nested conditionals. Legacy debt: " +
        String(baselineViolations.length) +
        " -> " +
        String(currentViolations.length) +
        "."
    );
}
