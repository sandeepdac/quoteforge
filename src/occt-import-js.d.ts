declare module 'occt-import-js' {
  /** Emscripten module factory. Resolves to the initialized OCCT module. */
  const occtimportjs: (moduleOverrides?: {
    locateFile?: (path: string, prefix: string) => string;
  }) => Promise<OcctModule>;
  export default occtimportjs;

  export interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }

  export interface OcctReadResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  export interface OcctModule {
    ReadStepFile(buffer: Uint8Array, params: unknown): OcctReadResult;
    ReadIgesFile(buffer: Uint8Array, params: unknown): OcctReadResult;
    ReadBrepFile(buffer: Uint8Array, params: unknown): OcctReadResult;
  }
}

declare module '*.wasm?url' {
  const src: string;
  export default src;
}
