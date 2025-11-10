/**
 * Typed message interfaces for the worker channel.
 * Keep them permissive (optional fields) but provide names for common fields
 * so TypeScript can catch typos and missing properties earlier.
 */

export type WebUsbRequestType =
    | 'START' | 'STOP' | 'OPEN' | 'CLOSE' | 'CLOSE_ALL'
    | 'GET_DEV_NAME' | 'GET_SERIAL_NUMBER' | 'GET_RX_SAMPLES_COUNT'
    | 'SEND_COMMAND' | 'SEND_DEBUG_COMMAND' | 'SUBMIT_RX_PACKET' | 'SEND_TX_PACKET'
    | 'GET_STREAM_STATUS' | 'SET_STREAM_STATUS' | 'GET_CONFIGURATION' | 'GET_OPENED_DEVICE_LIST';

interface IBaseReq {
    id?: number | string;
}

/* Discriminated (tagged) union request types */
export interface IStartReq extends IBaseReq { type: 'START' }
export interface IStopReq extends IBaseReq { type: 'STOP' }

export interface IOpenReq extends IBaseReq {
    type: 'OPEN';
    vendorId: number;
    productId: number;
}

export interface ICloseReq extends IBaseReq {
    type: 'CLOSE';
    fd: number;
}

export interface ICloseAllReq extends IBaseReq { type: 'CLOSE_ALL' }

export interface IGetDevNameReq extends IBaseReq { type: 'GET_DEV_NAME'; fd: number }
export interface IGetSerialReq extends IBaseReq { type: 'GET_SERIAL_NUMBER'; fd: number }
export interface IGetRxSamplesCountReq extends IBaseReq { type: 'GET_RX_SAMPLES_COUNT'; fd: number; samples?: number }

export interface ISendCommandReq extends IBaseReq { type: 'SEND_COMMAND'; fd: number; req: any }
export interface ISendDebugCommandReq extends IBaseReq { type: 'SEND_DEBUG_COMMAND'; fd: number; req: any }

export interface ISubmitRxPacketReq extends IBaseReq { type: 'SUBMIT_RX_PACKET'; fd: number; samples: any; opts?: any }
export interface ISendTxPacketReq extends IBaseReq { type: 'SEND_TX_PACKET'; fd: number; data: any; opts?: any }

export interface IGetStreamStatusReq extends IBaseReq { type: 'GET_STREAM_STATUS'; fd: number }
export interface ISetStreamStatusReq extends IBaseReq { type: 'SET_STREAM_STATUS'; fd: number; status: any }

export interface IGetConfigurationReq extends IBaseReq { type: 'GET_CONFIGURATION'; fd: number }

export interface IGetOpenedDeviceListReq extends IBaseReq { type: 'GET_OPENED_DEVICE_LIST' }

/* union of all request shapes */
export type WebUsbWorkerRequest =
    | IStartReq
    | IStopReq
    | IOpenReq
    | ICloseReq
    | ICloseAllReq
    | IGetDevNameReq
    | IGetSerialReq
    | IGetRxSamplesCountReq
    | ISendCommandReq
    | ISendDebugCommandReq
    | ISubmitRxPacketReq
    | ISendTxPacketReq
    | IGetStreamStatusReq
    | ISetStreamStatusReq
    | IGetConfigurationReq
    | IGetOpenedDeviceListReq;

/* response shape */
export interface WebUsbWorkerResponse {
    type?: WebUsbRequestType | undefined;
    id?: number | string | undefined;
    res: 'ok' | 'error';
    ret?: any;
    err?: any;
}