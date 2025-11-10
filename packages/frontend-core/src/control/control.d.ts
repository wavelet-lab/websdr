export interface ControlModule extends EmscriptenModule {
    _init_lib(device: number, vid: number, pid: number): number;
    _close_device(fd: number): number;
    _send_command(fd: number, cmd: number, cmd_len: number, res: number, res_len: number): number;
    _send_debug_command(fd: number, cmd: number, cmd_len: number, res: number, res_len: number): number;
    ccall(func: string, ret_type: string, parm_types: Array<string>, parms: Array<any>, opts: Record<string, any>): any;
    AsciiToString(buf: number): string;
    stringToAscii(str: string, buf: number): void;
}

declare const Module: EmscriptenModuleFactory<ControlModule>;
declare global {
    var controlModule: ControlModule | undefined;
}

export default Module;