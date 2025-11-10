export async function ensureWebUsb(): Promise<any> {
    if (typeof navigator !== 'undefined' && (navigator as any).usb) {
        return (navigator as any).usb;
    }

    // Try prefer "usb" package (recommended by maintainer warning), then fallback to "webusb"
    const tryLoad = async (name: string) => {
        try {
            const mod = await import(name);
            if (!mod) {
                throw null;
            }
            // try common export shapes
            const webusb = mod.webusb ?? mod.default ?? mod;
            return webusb;
        } catch {
            try {
                // CommonJS fallback
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const mod = require(name);
                if (!mod) {
                    throw null;
                }
                const webusb = mod.webusb ?? mod.default ?? mod;
                return webusb;
            } catch {
                return null;
            }
        }
    };

    let usbImpl = await tryLoad('usb');
    if (!usbImpl) {
        usbImpl = await tryLoad('webusb');
    }
    if (!usbImpl) {
        throw new Error('No WebUSB implementation found: install "usb" (preferred) or "webusb"');
    }

    // Patch globals so consumer code expecting navigator.usb works
    try {
        if (typeof navigator === 'undefined') {
            (globalThis as any).navigator = { usb: usbImpl };
        } else {
            (navigator as any).usb = usbImpl;
        }
    } catch {
        // best-effort only
    }

    return usbImpl;
}
