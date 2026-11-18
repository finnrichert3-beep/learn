// Minimal typings for the parts of d3-force-3d this project uses.
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x: number;
    y: number;
    z: number;
    vx?: number;
    vy?: number;
    vz?: number;
  }

  export interface SimLink<N extends SimNode> {
    source: N | number | string;
    target: N | number | string;
  }

  export interface Force {
    (alpha: number): void;
  }

  type Accessor<T, R> = R | ((datum: T, index: number) => R);

  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    stop(): this;
    alpha(value: number): this;
    alphaDecay(value: number): this;
    alphaMin(value: number): this;
    velocityDecay(value: number): this;
    randomSource(source: () => number): this;
    force(name: string, force: Force | null): this;
    nodes(): N[];
  }

  export function forceSimulation<N extends SimNode>(nodes: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;

  export interface LinkForce<N extends SimNode, L extends SimLink<N>> extends Force {
    id(accessor: (node: N) => string | number): this;
    distance(value: Accessor<L, number>): this;
    strength(value: Accessor<L, number>): this;
    iterations(value: number): this;
  }
  export function forceLink<N extends SimNode, L extends SimLink<N>>(links?: L[]): LinkForce<N, L>;

  export interface ManyBodyForce<N extends SimNode> extends Force {
    strength(value: Accessor<N, number>): this;
    distanceMax(value: number): this;
    theta(value: number): this;
  }
  export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;

  export interface CollideForce<N extends SimNode> extends Force {
    radius(value: Accessor<N, number>): this;
    strength(value: number): this;
    iterations(value: number): this;
  }
  export function forceCollide<N extends SimNode>(radius?: Accessor<N, number>): CollideForce<N>;

  export interface PositionForce<N extends SimNode> extends Force {
    strength(value: Accessor<N, number>): this;
  }
  export function forceX<N extends SimNode>(x?: Accessor<N, number>): PositionForce<N>;
  export function forceY<N extends SimNode>(y?: Accessor<N, number>): PositionForce<N>;
  export function forceZ<N extends SimNode>(z?: Accessor<N, number>): PositionForce<N>;
}
