import type { ParsedBinaryStl } from "./stl";

export interface ParsedModelPart {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly triangleOffset: number;
  readonly triangleCount: number;
}

export interface ParsedModelMesh extends ParsedBinaryStl {
  readonly colors?: Float32Array;
  readonly parts?: readonly ParsedModelPart[];
}
