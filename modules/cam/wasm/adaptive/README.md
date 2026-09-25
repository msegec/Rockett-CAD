# adaptive.wasm

`adaptive.wasm` is FreeCAD's adaptive clearing engine built to WebAssembly
(DEC-618). `modules/cam/src/toolpath/adaptiveEngine.ts` loads it and exports
`adaptiveClear`, its only entry point. The file is separate and replaceable:
any build that keeps the `adaptive` export and its number layout in
`entry.cpp` can take its place without rebuilding Rockett CAD.

## Licence

`adaptive.wasm` is licensed LGPL-2.1-or-later. The licence text is
`freecad/LICENSE`. The Clipper libraries inside it are BSL-1.0, with their
text in `freecad/src/3rdParty/Clipper2/LICENSE`. `entry.cpp`, the glue this
repository adds, is offered under LGPL-2.1-or-later as part of the same work.

| File                                           | Licence header                |
| ---------------------------------------------- | ----------------------------- |
| `freecad/src/Mod/CAM/libarea/Adaptive.cpp`     | LGPL-2.1-or-later (SPDX)      |
| `freecad/src/Mod/CAM/libarea/Adaptive.hpp`     | LGPL-2.1-or-later (SPDX)      |
| `freecad/src/Mod/CAM/libarea/clipper.cpp`      | BSL-1.0 (SPDX), Clipper 6.4.2 |
| `freecad/src/Mod/CAM/libarea/clipper.hpp`      | BSL-1.0 (SPDX), Clipper 6.4.2 |
| `freecad/src/3rdParty/Clipper2/Clipper2Lib/**` | Boost 1.0 URL, Clipper2 2.0.1 |

## Source

Every file under `freecad/` is byte for byte the file at the same path in
https://github.com/FreeCAD/FreeCAD at commit
`c1d008a9fcf4fd66644852c5d334d22aedd62921`. Only the files the build needs
are kept. `SHA256SUMS` records each file and the built `adaptive.wasm`.

## Build

`./build.sh` needs Podman and network access only to pull the image. It
checks the sources against `SHA256SUMS`, compiles them with Emscripten 6.0.10
from `emscripten/emsdk@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65`,
the image the opencascade.js fork pins, in a container with no network, and
checks the new `adaptive.wasm` against the recorded sum.

The build targets wasm64 (`-m64`). The engine stores scaled coordinates in
C `long`, which is 32 bits in wasm32 and overflows on parts a few hundred
millimetres from the origin at fine tolerance.

## Source offer

The corresponding source of `adaptive.wasm` is this directory at the Rockett
CAD commit that ships it: the sources, `entry.cpp` and `build.sh`. Rockett
CAD is for intranet use only and is not distributed. Before distribution,
accompany `adaptive.wasm` with this directory or a written offer of it, as
LGPL-2.1 section 6 requires.
