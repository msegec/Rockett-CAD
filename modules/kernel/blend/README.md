# blend.wasm

`blend.wasm` is Rockett CAD's own blend surface module (KERN-020).
`server/src/geometry/blendModule.ts` compiles it once per process, runs each
call in a fresh instance and turns a trap into a plain error.

`fillet_planes` takes a straight edge, the outward normal of each plane
beside it and the direction from the edge into each plane, and a radius. It
returns the exact centre and contact points of the fillet section at both
ends, or declines a concave edge, a flat or knife fold, and an edge that does
not lie in both planes. A number that is not finite traps.

`chamfer_section` takes a straight edge, the outward normal, the direction
into the face and a signed radius for each side, and a distance. A radius of
0 is a plane; otherwise the face is a cylinder whose axis runs parallel to the
edge. It returns the contact point on each side at both ends, at the chord
distance from the edge as OCCT measures it, or declines a flat or knife fold,
an edge that does not lie in both faces, and a distance longer than a
cylinder's diameter.

## Licence

`THIRD-PARTY-NOTICES.md` at the repository root owns the notice for the
toolchain code linked into `blend.wasm`.

## Build

`./build.sh` needs Podman and the pinned Emscripten image already pulled; it
never pulls. It checks `entry.cpp` against `SHA256SUMS`, compiles it with
that image in a container with no network, and checks the new `blend.wasm`
against the recorded sum.
