function canNativeShare(data: ShareData): boolean {
    if (typeof navigator.share !== "function") return false;
    if (typeof navigator.canShare !== "function") return true;
    return navigator.canShare(data);
}

export async function shareUrl(
    url: string,
    title = document.title
): Promise<boolean> {
    const shareData: ShareData = {
        title,
        url: new URL(url, window.location.href).toString()
    };

    if (!canNativeShare(shareData)) return false;

    try {
        await navigator.share(shareData);
        return true;
    } catch {
        return false;
    }
}
