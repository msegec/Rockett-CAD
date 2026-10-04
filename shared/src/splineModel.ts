import type { EdgeRef } from "./model.js";

export interface SketchSpline {
  projection?: EdgeRef;
  id: string;
  kind: "spline";
  degree: number;
  poles: string[];
  weights?: number[];
  knots: number[];
  multiplicities: number[];
  periodic?: boolean;
  rho?: number;
  construction?: boolean;
  external?: boolean;
}

export interface SketchFitSpline {
  projection?: EdgeRef;
  id: string;
  kind: "fitSpline";
  points: string[];
  handles: [string, string];
  construction?: boolean;
  external?: boolean;
}
