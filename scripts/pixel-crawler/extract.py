#!/usr/bin/env python3
"""Reusable CLI for pulling one placeable object out of a Pixel Crawler
multi-object sheet (via objects.components()/crop()), and for scanning the
pack to flag which sheets need this treatment.

See docs/ASSETS.md "Sprite extraction pipeline" for the 3-class rule this
implements, and scripts/pixel-crawler/README.md for the rest of the toolset.

Usage:
    # Preview a sheet's connected components (index/bbox/size) before extracting.
    python3 scripts/pixel-crawler/extract.py --list <sheet-rel>

    # Crop component <index> out of <sheet-rel> and save it under the pack dir.
    python3 scripts/pixel-crawler/extract.py <sheet-rel> <index> <out-rel>

    # Walk the pack (or a subdir) and flag multi-object sheets that need extraction.
    python3 scripts/pixel-crawler/extract.py --scan [dir]

Optional tunables (all modes): --alpha-thresh --gap --min-area (forwarded to
objects.components()/preview_components() — use if a component comes out
merged/split).
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from compose import PC, sheet  # noqa: E402
from objects import components, crop, preview_components  # noqa: E402

GRIDS = os.path.join(os.path.dirname(__file__), "grids")


def add_tunables(p):
    p.add_argument("--alpha-thresh", type=int, default=8, dest="alpha_thresh")
    p.add_argument("--gap", type=int, default=1)
    p.add_argument("--min-area", type=int, default=40, dest="min_area")


def tunable_kwargs(args):
    return {"alpha_thresh": args.alpha_thresh, "gap": args.gap, "min_area": args.min_area}


def cmd_list(args):
    os.makedirs(GRIDS, exist_ok=True)
    sanitised = re.sub(r"[^A-Za-z0-9]+", "_", args.sheet_rel).strip("_")
    out = os.path.join(GRIDS, f"list_{sanitised}.png")
    preview_components(args.sheet_rel, out, **tunable_kwargs(args))
    print(f"preview -> {out}")


def cmd_scan(args):
    root = args.scan_dir or PC
    tilesets_prefix = os.path.join("Environment", "Tilesets") + os.sep

    results = []  # (rel, label, detail)
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in sorted(filenames):
            if not fn.lower().endswith(".png"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, PC)

            if rel.startswith(tilesets_prefix) or rel == "Environment/Tilesets":
                results.append((rel, "grid (skip)", ""))
                continue
            if fn.endswith("-Sheet.png"):
                results.append((rel, "strip (skip)", ""))
                continue

            try:
                boxes = components(rel, **tunable_kwargs(args))
            except Exception as e:  # noqa: BLE001 - report and keep scanning
                results.append((rel, "ERROR", str(e)))
                continue

            count = len(boxes)
            if count > 1:
                sizes = ", ".join(f"{x1-x0}x{y1-y0}" for x0, y0, x1, y1 in boxes)
                results.append((rel, "MULTI-OBJECT -> needs extraction", f"{count} components: {sizes}"))
            elif count == 1:
                x0, y0, x1, y1 = boxes[0]
                results.append((rel, "single-object", f"{x1-x0}x{y1-y0}"))
            else:
                results.append((rel, "no-components", ""))

    order = {"MULTI-OBJECT -> needs extraction": 0, "single-object": 1, "ERROR": 2,
             "no-components": 3, "strip (skip)": 4, "grid (skip)": 5}
    results.sort(key=lambda r: (order.get(r[1], 9), r[0]))

    for rel, label, detail in results:
        line = f"{label:<32} {rel}"
        if detail:
            line += f"  ({detail})"
        print(line)

    n_multi = sum(1 for _, label, _ in results if label.startswith("MULTI-OBJECT"))
    print(f"\n{len(results)} PNGs scanned under {os.path.relpath(root, PC) or '.'} "
          f"— {n_multi} flagged multi-object.")


def cmd_extract(args):
    box = components(args.sheet_rel, **tunable_kwargs(args))[args.index]
    img = crop(args.sheet_rel, box)
    out_path = os.path.join(PC, args.out_rel)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path)
    print(f"[{args.index}] box={box} -> {out_path} size={img.size}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_tunables(p)
    p.add_argument("--list", metavar="SHEET_REL", dest="list_rel", help="preview components of a sheet")
    p.add_argument("--scan", nargs="?", const="", metavar="DIR", dest="scan_dir_flag",
                   help="scan pack (or DIR) for multi-object sheets needing extraction")
    p.add_argument("sheet_rel", nargs="?", help="sheet path, relative to the pack root")
    p.add_argument("index", nargs="?", type=int, help="component index to extract")
    p.add_argument("out_rel", nargs="?", help="output path, relative to the pack root")
    args = p.parse_args()

    if args.list_rel is not None:
        args.sheet_rel = args.list_rel
        cmd_list(args)
    elif args.scan_dir_flag is not None:
        args.scan_dir = os.path.join(PC, args.scan_dir_flag) if args.scan_dir_flag else None
        cmd_scan(args)
    elif args.sheet_rel is not None and args.index is not None and args.out_rel is not None:
        cmd_extract(args)
    else:
        p.error("specify --list <sheet-rel>, --scan [dir], or <sheet-rel> <index> <out-rel>")


if __name__ == "__main__":
    main()
