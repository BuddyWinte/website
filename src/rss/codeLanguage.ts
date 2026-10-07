import type { CodeTranspileLang } from "./types.ts";

export function normCodeLangKey(lang: string): string {
    const clean = lang.trim().toLowerCase();

    const aliases: Readonly<Record<string, string>> = {
        javascript: "js",
        js: "js",
        node: "js",
        nodejs: "js",
        typescript: "ts",
        ts: "ts",
        tsx: "tsx",
        jsx: "jsx",
        powershell: "powershell",
        pwsh: "powershell",
        ps: "powershell",
        ps1: "powershell",
        bash: "bash",
        shell: "bash",
        sh: "bash",
        zsh: "bash",
        py: "python",
        python: "python"
    };

    return aliases[clean] ?? clean;
}

export function fmtCodeLang(lang: string): string {
    const clean = lang.trim();
    const key = normCodeLangKey(clean);

    if (clean.length === 0) return "TEXT";
    if (key === "ts") return "TYPESCRIPT";
    if (key === "tsx") return "TSX";
    if (key === "js") return "JAVASCRIPT";
    if (key === "python") return "PYTHON";
    if (key === "powershell") return "POWERSHELL";
    if (key === "bash") return "BASH";

    return clean.toUpperCase();
}

export function getCodeLang(code: HTMLElement): string {
    const cls = Array.from(code.classList).find((name) => {
        return name.startsWith("language-") || name.startsWith("lang-");
    });

    const raw = cls
        ?.replace(/^language-/, "")
        .replace(/^lang-/, "")
        .trim();

    return raw && raw.length > 0
        ? raw
        : "text";
}

export function isCodeTranspileLang(
    lang: string
): lang is CodeTranspileLang {
    return lang === "js"
        || lang === "jsx"
        || lang === "ts"
        || lang === "tsx";
}

export function normTranspileLang(
    value: string
): CodeTranspileLang | null {
    const clean = normCodeLangKey(value);
    return isCodeTranspileLang(clean) ? clean : null;
}
