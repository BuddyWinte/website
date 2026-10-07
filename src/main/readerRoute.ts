export async function loadReaderRuntime() {
    const [readerMode, reader, readAloud] = await Promise.all([
        import("../readerMode.ts"),
        import("../reader.tsx"),
        import("../readAloud.tsx")
    ]);

    return {
        setupReaderToggle: readerMode.setupReaderToggle,
        initReaderModeTip: reader.initReaderModeTip,
        readerModeFocus: reader.readerModeFocus,
        readerModeKeep: reader.readerModeKeep,
        showReadAloudMenu: readAloud.showMenu
    } as const;
}
