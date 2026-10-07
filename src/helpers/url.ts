export function getUrlParam(
    name: string,
    url: string = window.location.href
): string | null {
    return new URL(url, window.location.href).searchParams.get(name);
}

export function setUrlParam(
    name: string,
    value: string,
    url: string = window.location.href
): string {
    const nextUrl = new URL(url, window.location.href);
    nextUrl.searchParams.set(name, value);
    return nextUrl.toString();
}

export function removeUrlParam(
    name: string,
    url: string = window.location.href
): string {
    const nextUrl = new URL(url, window.location.href);
    nextUrl.searchParams.delete(name);
    return nextUrl.toString();
}
