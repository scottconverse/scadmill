"""ScadMill independence gate (spec §2.5) — OWNER-SUPPLIED. Implementers wire it into CI
(see ci-similarity-gate.yml) but never run it locally and never modify it: executing it
requires cloning the comparison repositories, which must not land on an implementer machine.

Method (same as the July 2026 derivation measurement): for every source file in the candidate
repo, find the best-matching file in each comparison tree (same relative path first, content
search as rename fallback) and score with difflib on whitespace-normalized non-empty lines.
LOC-weighted. Output is scores and file names ONLY — never file content.

Thresholds (spec §2.5): FAIL if any file >= MAX_FILE_SIM with >= MIN_LOC lines, or if the
LOC-weighted mean similarity > MAX_MEAN. Exit 0 = pass, 2 = breach, 1 = usage error.

Usage:
  python similarity_gate.py --candidate <repo/src> --against <name>=<path/src> [--against ...]
                            [--json report.json]
"""
import argparse
import difflib
import json
import sys
from pathlib import Path

MAX_FILE_SIM = 0.60
MAX_MEAN = 0.25
MIN_LOC = 20
EXTS = {".ts", ".tsx", ".js", ".jsx", ".css", ".rs", ".html", ".svelte", ".vue"}
SKIP_DIRS = {"node_modules", "dist", "build", "target", ".git", "coverage", "__pycache__"}


def load_tree(root: Path) -> dict:
    out = {}
    for p in root.rglob("*"):
        if p.suffix not in EXTS or not p.is_file():
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if lines:
            out[str(p.relative_to(root)).replace("\\", "/")] = lines
    return out


def ratio(a: list, b: list) -> float:
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    if sm.real_quick_ratio() < 0.2:
        return 0.0
    return sm.ratio()


def best_match(rel: str, lines: list, comparison: dict) -> tuple:
    best, best_r = None, 0.0
    if rel in comparison:
        best, best_r = rel, ratio(lines, comparison[rel])
    if best_r < 0.5 and len(lines) >= 30:
        for crel, clines in comparison.items():
            if abs(len(clines) - len(lines)) > max(len(lines), len(clines)) * 0.6:
                continue
            r = ratio(lines, clines)
            if r > best_r:
                best, best_r = crel, r
    return best, best_r


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", required=True, type=Path)
    ap.add_argument("--against", action="append", required=True,
                    help="name=path of a comparison source tree; repeatable")
    ap.add_argument("--json", type=Path, help="write scores-only JSON report here")
    args = ap.parse_args()

    candidate = load_tree(args.candidate)
    if not candidate:
        print(f"ERROR: no source files under {args.candidate}")
        return 1

    breaches, report = [], {}
    for spec_arg in args.against:
        name, _, path = spec_arg.partition("=")
        comparison = load_tree(Path(path))
        if not comparison:
            print(f"ERROR: no source files under comparison '{name}' ({path})")
            return 1
        rows, weighted = [], 0.0
        total_loc = sum(len(v) for v in candidate.values())
        for rel, lines in candidate.items():
            match, sim = best_match(rel, lines, comparison)
            rows.append({"file": rel, "loc": len(lines), "sim": round(sim, 3)})
            weighted += sim * len(lines)
            if sim >= MAX_FILE_SIM and len(lines) >= MIN_LOC:
                breaches.append(f"[{name}] {rel} sim={sim:.2f} loc={len(lines)}")
        mean = weighted / max(total_loc, 1)
        if mean > MAX_MEAN:
            breaches.append(f"[{name}] LOC-weighted mean {mean:.3f} > {MAX_MEAN}")
        report[name] = {"weightedMean": round(mean, 4), "totalLOC": total_loc,
                        "files": sorted(rows, key=lambda r: -r["sim"])[:50]}
        print(f"{name}: {len(candidate)} files, {total_loc} LOC, weighted mean {mean:.3f}")

    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    if breaches:
        print("\nINDEPENDENCE GATE: FAIL")
        for b in breaches:
            print("  " + b)
        print("Rewrite the flagged files from the specification (spec section 2.5); "
              "this report intentionally contains no compared content.")
        return 2
    print("\nINDEPENDENCE GATE: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
