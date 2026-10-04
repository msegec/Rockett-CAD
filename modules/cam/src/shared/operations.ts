export const OPERATION_VERSIONS = {
  "rockett.cam.facing": 1,
} as const satisfies Record<string, number>;

export type OperationType = keyof typeof OPERATION_VERSIONS;

export const isOperation = (type: string): type is OperationType =>
  Object.hasOwn(OPERATION_VERSIONS, type);
