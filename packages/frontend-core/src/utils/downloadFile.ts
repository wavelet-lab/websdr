export function downloadFile(buf: any, fname: string) {
    let a = document.createElement('a');
    const buffer = Buffer.from(buf);
    a.href = "data:application/octet-stream;base64," + buffer.toString('base64');
    a.download = fname;
    a.click();
}
