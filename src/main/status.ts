import * as config from "../config.ts";
import { isRecord } from "../helpers/index.ts";

type StatusOk = Readonly<{
    ok: true;
    online: true;
    now: string;
}>;

export type StatusRes =
    | Readonly<{ kind: "online"; now: string }>
    | Readonly<{ kind: "offline"; reason: string }>;

function readJson(res: Response): Promise<unknown> {
    return res.json().catch(() => null);
}

export async function fetchStatus(timeoutMs: number): Promise<StatusRes> {
    const ctl = new AbortController();
    const tid = window.setTimeout(() => ctl.abort(), timeoutMs);

    try {
        const res = await fetch(config.statusEndpointUrl, {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            signal: ctl.signal,
            headers: { accept: "application/json" }
        });

        if (!res.ok) {
            return {
                kind: "offline",
                reason: "status endpoint returned " + String(res.status)
            };
        }

        const bodyUnknown: unknown = await readJson(res);

        const looksOk =
            isRecord(bodyUnknown) &&
            bodyUnknown.ok === true &&
            bodyUnknown.online === true &&
            typeof bodyUnknown.now === "string" &&
            bodyUnknown.now.length > 0;

        if (!looksOk) {
            return {
                kind: "offline",
                reason: "status endpoint returned unexpected payload"
            };
        }

        const body = bodyUnknown as StatusOk;
        return { kind: "online", now: body.now };
    } catch (error: unknown) {
        const reason = error instanceof Error
            ? error.message
            : "unknown error";

        return { kind: "offline", reason };
    } finally {
        window.clearTimeout(tid);
    }
}
