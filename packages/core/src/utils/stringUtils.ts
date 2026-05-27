export function containsAnySubstr(str: string | undefined | null, substrs: string | Array<string | undefined | null> | undefined | null, caseSensitive = false): boolean {
    if (!str || !substrs) return false;
    const text = caseSensitive ? str : str.toLowerCase();
    if (!Array.isArray(substrs)) substrs = [substrs];
    for (const substr of substrs) {
        if (!substr) continue;
        const substrConv = caseSensitive ? substr : substr.toLowerCase().trim();
        if (substrConv === '') continue;
        if (text.includes(substrConv)) return true;
    }
    return false;
}
export function printBin(v: number, d = 8) {
    let ret = '';
    for (let mask = 1 << (d - 1); mask > 0; mask >>= 1) {
        ret += (v & mask) ? '1' : '0';
    }
    return ret;
}
