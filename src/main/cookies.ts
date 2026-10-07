export function getCookie(name: string): string | null {
    const cookies = document.cookie.split("; ");
    const cookie = cookies.find(
        (row) => row.startsWith(name + "=")
    );

    return cookie ? cookie.split("=")[1] ?? null : null;
}

export function setCookie(
    name: string,
    value: string,
    days: number = 365
): void {
    const expires = new Date(
        Date.now() + days * 864e5
    ).toUTCString();

    document.cookie =
        name +
        "=" +
        value +
        "; expires=" +
        expires +
        "; path=/";
}
