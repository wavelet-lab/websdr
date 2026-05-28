export enum DataType {
    cf32 = 'cf32',
    ci16 = 'ci16',
    f32 = 'f32',
    i16 = 'i16',
    i8 = 'i8',
}

export const DataTypeNames: Record<DataType, string> = {
    [DataType.cf32]: 'Complex Float 32',
    [DataType.ci16]: 'Complex Int 16',
    [DataType.f32]: 'Float 32',
    [DataType.i16]: 'Int 16',
    [DataType.i8]: 'Int 8',
}

export enum StreamDataType {
    cf32 = 'cf32',
    ci16 = 'ci16',
    f32 = 'f32',
    i16 = 'i16',
    alaw = 'alaw',
}

export const StreamDataTypeNames: Record<StreamDataType, string> = {
    [StreamDataType.cf32]: 'Complex Float 32',
    [StreamDataType.ci16]: 'Complex Int 16',
    [StreamDataType.f32]: 'Float 32',
    [StreamDataType.i16]: 'Int 16',
    [StreamDataType.alaw]: 'A-Law',
}
