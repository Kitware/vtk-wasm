#!/usr/bin/env python3
"""Mirror VTK.wasm gzip bundles from the GitLab generic package registry into a
local directory laid out for hosting via jsDelivr / raw GitHub.

The script is stdlib-only so the workflow needs no `pip install`.

Both wasm32 and wasm64 builds are mirrored. Layout produced under the target dir:

    releases/<version>/vtk-<version>-wasm32-emscripten.tar.gz   (official releases)
    releases/<version>/vtk-<version>-wasm64-emscripten.tar.gz
    latest/vtk-wasm32-emscripten.tar.gz                          (newest weekly build)
    latest/vtk-wasm64-emscripten.tar.gz
    latest/wasm32.version                                        (version latest points to)
    latest/wasm64.version
    manifest.json                                               (index + CDN URLs)

Versions are classified by their patch component:
  * official release -> small patch, e.g. "9.6.2"
  * weekly build     -> 8-digit date patch, e.g. "9.6.20260621"

Usage:
    python scripts/sync-wasm-bundles.py [TARGET_DIR]   (default: ".")
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GITLAB = "https://gitlab.kitware.com"
PROJECT_ID = 13
ARCHES = ("wasm32", "wasm64")
REPO = os.environ.get("GITHUB_REPOSITORY", "Kitware/vtk-wasm")
DIST_REF = "dist"  # the branch jsDelivr/raw URLs resolve against

GZIP_MAGIC = b"\x1f\x8b"
MIN_BUNDLE_BYTES = 1_000_000  # a real bundle is ~22 MB; anything tiny is an error page
WEEKLY_PATCH_RE = re.compile(r"^\d{8}$")  # YYYYMMDD


def package_name(arch):
    return f"vtk-{arch}-emscripten"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "vtk-wasm-sync"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read(), resp.headers


def list_packages(name):
    """Return [{'version', 'created_at'}] for every published bundle, newest first."""
    packages = []
    page = 1
    while True:
        url = (
            f"{GITLAB}/api/v4/projects/{PROJECT_ID}/packages"
            f"?package_name={name}&per_page=100&page={page}"
            f"&order_by=created_at&sort=desc"
        )
        body, _ = _get(url)
        batch = json.loads(body)
        if not batch:
            break
        for pkg in batch:
            packages.append({"version": pkg["version"], "created_at": pkg.get("created_at")})
        page += 1
    packages.sort(key=lambda p: p["created_at"] or "", reverse=True)
    return packages


def is_weekly(version):
    parts = version.split(".")
    return bool(parts) and WEEKLY_PATCH_RE.match(parts[-1]) is not None


def version_key(version):
    """Numeric sort key so 9.10.0 sorts after 9.2.0."""
    return tuple(int(p) if p.isdigit() else p for p in version.split("."))


def bundle_filename(version, arch):
    return f"vtk-{version}-{arch}-emscripten.tar.gz"


def download_url(version, arch):
    return (
        f"{GITLAB}/api/v4/projects/{PROJECT_ID}/packages/generic/"
        f"{package_name(arch)}/{version}/{bundle_filename(version, arch)}"
    )


def download_bundle(version, arch, dest: Path):
    """Download and atomically write the bundle, validating it is a real gzip
    archive (guards against a 200-OK error page being committed)."""
    url = download_url(version, arch)
    data, headers = _get(url)
    if data[:2] != GZIP_MAGIC:
        raise RuntimeError(f"{url}: response is not gzip (got {data[:8]!r})")
    if len(data) < MIN_BUNDLE_BYTES:
        raise RuntimeError(f"{url}: suspiciously small ({len(data)} bytes)")
    declared = headers.get("Content-Length")
    if declared is not None and int(declared) != len(data):
        raise RuntimeError(f"{url}: truncated ({len(data)} of {declared} bytes)")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)
    print(f"  downloaded {version} ({arch}) -> {dest} ({len(data):,} bytes)")


def cdn_urls(relpath: str):
    relpath = relpath.replace(os.sep, "/")
    return {
        "jsdelivr": f"https://cdn.jsdelivr.net/gh/{REPO}@{DIST_REF}/{relpath}",
        "raw": f"https://raw.githubusercontent.com/{REPO}/{DIST_REF}/{relpath}",
    }


def entry(relpath: str):
    return {"path": relpath, "urls": cdn_urls(relpath)}


def sync_latest(target: Path, arch: str, newest: str):
    """Overwrite latest/<arch> with the newest weekly build for that arch."""
    latest_dir = target / "latest"
    # Stable, unversioned filename so consumers can pin a single URL.
    latest_file = latest_dir / f"{package_name(arch)}.tar.gz"
    version_file = latest_dir / f"{arch}.version"

    current = version_file.read_text().strip() if version_file.exists() else None
    if current == newest and latest_file.exists():
        print(f"latest {arch} already at {newest}; skipping")
    else:
        print(f"latest {arch}: {current or 'none'} -> {newest}")
        download_bundle(newest, arch, latest_file)
        version_file.write_text(newest + "\n")
    rel = str(latest_file.relative_to(target)).replace(os.sep, "/")
    return {"version": newest, **entry(rel)}


def sync_release(target: Path, arch: str, version: str):
    dest = target / "releases" / version / bundle_filename(version, arch)
    if dest.exists() and dest.stat().st_size >= MIN_BUNDLE_BYTES:
        print(f"release {version} ({arch}) already present; skipping")
    else:
        print(f"release {version} ({arch}): fetching")
        download_bundle(version, arch, dest)
    rel = str(dest.relative_to(target)).replace(os.sep, "/")
    return entry(rel)


def main():
    target = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    target.mkdir(parents=True, exist_ok=True)

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"{GITLAB}/api/v4/projects/{PROJECT_ID}/packages",
        "architectures": list(ARCHES),
        "latest": {},
        "releases": {},
    }

    # version -> {arch -> entry}; collected across architectures.
    release_map = {}

    for arch in ARCHES:
        packages = list_packages(package_name(arch))
        if not packages:
            print(f"No packages found for {arch}; skipping")
            continue
        weeklies = [p for p in packages if is_weekly(p["version"])]
        releases = [p for p in packages if not is_weekly(p["version"])]

        if weeklies:
            manifest["latest"][arch] = sync_latest(target, arch, weeklies[0]["version"])
        else:
            print(f"No weekly builds for {arch}; latest unchanged")

        for pkg in sorted(releases, key=lambda p: version_key(p["version"])):
            version = pkg["version"]
            release_map.setdefault(version, {})[arch] = sync_release(target, arch, version)

    for version in sorted(release_map, key=version_key):
        manifest["releases"][version] = release_map[version]

    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nWrote {target / 'manifest.json'}")
    latest_summary = ", ".join(
        f"{arch}={info['version']}" for arch, info in manifest["latest"].items()
    )
    print(f"latest: {latest_summary or 'none'}; releases: {len(manifest['releases'])}")


if __name__ == "__main__":
    main()
