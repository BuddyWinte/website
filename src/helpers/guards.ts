export function isRecord(
    value: unknown,
    acceptArrays: boolean = false
): value is Record<string, unknown> {
    return value !== null &&
        typeof value === "object" &&
        (acceptArrays || !Array.isArray(value));
}

export type SessionTokenResponse = Readonly<{
    sessionToken: string;
}>;

export type GetIpResponse = Readonly<{
    ip: string;
}>;

export function assertSessionTokenResponse(
    value: unknown
): asserts value is SessionTokenResponse {
    if (!isRecord(value)) {
        throw new Error("Invalid session-token payload: not an object");
    }

    if (typeof value.sessionToken !== "string") {
        throw new Error(
            "Invalid session-token payload: sessionToken is not a string"
        );
    }
}

export function assertGetIpResponse(
    value: unknown
): asserts value is GetIpResponse {
    if (!isRecord(value)) {
        throw new Error("Invalid get-ip payload: not an object");
    }

    if (typeof value.ip !== "string") {
        throw new Error("Invalid get-ip payload: ip is not a string");
    }
}
