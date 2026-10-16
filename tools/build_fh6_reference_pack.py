#!/usr/bin/env python3
"""Build a 100-image Forza Horizon 6 developer reference archive.

The script discovers official FH6 media on forza.net, downloads distinct images,
organizes them by development use, and writes a ZIP with source manifests.
"""

from __future__ import annotations

import csv
import hashlib
import html
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MEDIA_PAGE = "https://forza.net/media"
OUTPUT_NAME = "Forza-Horizon-6-Developer-Reference-Pack-100-Images.zip"
BUILD_DATE = "2026-10-16"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36"
)
IMAGE_RE = re.compile(
    r"https://cdn\.forza\.net/strapi-uploads/assets/[^\"'<>\\\s?]+\.(?:jpe?g|png|webp)",
    re.IGNORECASE,
)
FH6_RE = re.compile(r"(?:forza[_-]?horizon[_-]?6|horizon[_-]?6|fh[_-]?6)", re.IGNORECASE)
SIZE_PREFIX_RE = re.compile(r"^(?:thumbnail|small|medium|large)_", re.IGNORECASE)


@dataclass(frozen=True)
class Asset:
    key: str
    preview_url: str
    original_url: str
    base_name: str
    category: str
    purpose: str


@dataclass
class Downloaded:
    asset: Asset
    data: bytes
    source_url: str
    extension: str
    sha256: str
    width_hint: str


def request_bytes(url: str, timeout: int = 45) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Referer": MEDIA_PAGE,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        data = response.read()
    return data, content_type


def fetch_media_html() -> str:
    request = urllib.request.Request(
        MEDIA_PAGE,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode("utf-8", errors="replace")
    return html.unescape(raw.replace("\\u002F", "/").replace("\\/", "/"))


def canonical_key(url: str) -> str:
    filename = urllib.parse.unquote(url.rsplit("/", 1)[-1])
    filename = SIZE_PREFIX_RE.sub("", filename)
    return re.sub(r"\.(?:jpe?g|png|webp)$", "", filename, flags=re.IGNORECASE).lower()


def original_url(url: str) -> str:
    stem = url.rsplit("/", 1)[-1]
    stem = SIZE_PREFIX_RE.sub("", stem)
    return url.rsplit("/", 1)[0] + "/" + stem


def sanitize(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("_")
    return cleaned[:140] or "reference"


def classify(name: str) -> tuple[str, str]:
    value = name.lower()
    if re.search(r"map|menu|playlist|journal|collection|wristband|reward|interface|hud|controller|headset", value):
        return (
            "04_UI_Menu_Map",
            "UI hierarchy, map presentation, progression, menus, HUD and graphic-design language",
        )
    if re.search(r"garage|custom|liver|aero|estate|home|meet|showroom|engine|upgrade", value):
        return (
            "06_Garage_Customization",
            "garage staging, customization presentation, materials and vehicle-detail framing",
        )
    if re.search(r"night|neon|rain|snow|winter|sunset|dawn|fog|ray|reflection|wet|storm", value):
        return (
            "05_Lighting_Weather",
            "lighting, reflections, atmosphere, weather response and post-processing",
        )
    if re.search(r"race|touge|drift|drag|rally|circuit|speed|chase|offroad|jump|action|stunt", value):
        return (
            "03_Gameplay_Racing",
            "camera placement, vehicle dynamics, speed readability and race-event composition",
        )
    if re.search(r"city|tokyo|castle|rural|vista|mountain|fuji|village|alley|expressway|dock|harbor|forest|coast|landscape|road|season|festival", value):
        return (
            "02_Environments_World",
            "world building, road language, architecture, foliage, density and environmental composition",
        )
    if re.search(r"car|auto|vehicle|porsche|toyota|nissan|mazda|ferrari|lamborghini|bmw|audi|ford|honda|subaru|mitsubishi|bentley|lotus|mclaren|chevrolet|mercedes", value):
        return (
            "01_Vehicles_Models",
            "vehicle proportions, materials, bodywork, wheels, trim and production-quality presentation",
        )
    return (
        "07_Mixed_Reference",
        "general visual-quality, composition and gameplay-reference study",
    )


def discover_assets() -> list[Asset]:
    source = fetch_media_html()
    grouped: dict[str, str] = {}
    for match in IMAGE_RE.findall(source):
        url = match.replace("\\", "")
        decoded = urllib.parse.unquote(url)
        if not FH6_RE.search(decoded):
            continue
        if re.search(r"logo|icon|paper_background|wordmark|favicon", decoded, re.IGNORECASE):
            continue
        key = canonical_key(url)
        current = grouped.get(key)
        if current is None or variant_rank(url) > variant_rank(current):
            grouped[key] = url

    assets: list[Asset] = []
    for key, preview in grouped.items():
        raw_name = urllib.parse.unquote(preview.rsplit("/", 1)[-1])
        raw_name = SIZE_PREFIX_RE.sub("", raw_name)
        raw_name = re.sub(r"\.(?:jpe?g|png|webp)$", "", raw_name, flags=re.IGNORECASE)
        base_name = sanitize(raw_name)
        category, purpose = classify(base_name)
        assets.append(
            Asset(
                key=key,
                preview_url=preview,
                original_url=original_url(preview),
                base_name=base_name,
                category=category,
                purpose=purpose,
            )
        )
    assets.sort(key=lambda item: (item.category, item.base_name.lower()))
    return assets


def variant_rank(url: str) -> int:
    filename = url.rsplit("/", 1)[-1].lower()
    if filename.startswith("large_"):
        return 4
    if filename.startswith("medium_"):
        return 3
    if filename.startswith("small_"):
        return 2
    if filename.startswith("thumbnail_"):
        return 1
    return 5


def candidate_urls(asset: Asset) -> list[tuple[str, str]]:
    directory, preview_name = asset.preview_url.rsplit("/", 1)
    bare = SIZE_PREFIX_RE.sub("", preview_name)
    base_no_ext = re.sub(r"\.(?:jpe?g|png|webp)$", "", bare, flags=re.IGNORECASE)
    preview_ext = bare.rsplit(".", 1)[-1].lower()

    candidates: list[tuple[str, str]] = []
    for prefix, label in [
        ("", "original/full resolution"),
        ("large_", "large derivative"),
        ("medium_", "medium derivative"),
        ("small_", "small derivative"),
    ]:
        for extension in [preview_ext, "jpg", "webp", "png"]:
            candidates.append((f"{directory}/{prefix}{base_no_ext}.{extension}", label))
    candidates.append((asset.preview_url, "published preview"))

    unique: list[tuple[str, str]] = []
    seen: set[str] = set()
    for url, label in candidates:
        if url not in seen:
            unique.append((url, label))
            seen.add(url)
    return unique


def extension_from(content_type: str, url: str) -> str:
    if "webp" in content_type:
        return "webp"
    if "png" in content_type:
        return "png"
    if "jpeg" in content_type or "jpg" in content_type:
        return "jpg"
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower().lstrip(".")
    return suffix if suffix in {"jpg", "jpeg", "png", "webp"} else "jpg"


def looks_like_image(data: bytes, content_type: str) -> bool:
    if len(data) < 4_096 or len(data) > 20_000_000:
        return False
    if content_type.startswith("image/"):
        return True
    return (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")
    )


def download_asset(asset: Asset) -> Downloaded | None:
    for attempt in range(2):
        for url, quality in candidate_urls(asset):
            try:
                data, content_type = request_bytes(url)
                if not looks_like_image(data, content_type):
                    continue
                return Downloaded(
                    asset=asset,
                    data=data,
                    source_url=url,
                    extension=extension_from(content_type, url),
                    sha256=hashlib.sha256(data).hexdigest(),
                    width_hint=quality,
                )
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
                continue
        if attempt == 0:
            time.sleep(1.0)
    return None


def balanced_order(assets: Iterable[Asset]) -> list[Asset]:
    assets = list(assets)
    quotas = [
        ("01_Vehicles_Models", 25),
        ("02_Environments_World", 20),
        ("03_Gameplay_Racing", 20),
        ("04_UI_Menu_Map", 10),
        ("05_Lighting_Weather", 10),
        ("06_Garage_Customization", 10),
        ("07_Mixed_Reference", 5),
    ]
    selected: list[Asset] = []
    used: set[str] = set()
    for category, quota in quotas:
        count = 0
        for asset in assets:
            if count >= quota:
                break
            if asset.category == category and asset.key not in used:
                selected.append(asset)
                used.add(asset.key)
                count += 1
    for asset in assets:
        if asset.key not in used:
            selected.append(asset)
            used.add(asset.key)
    return selected


def write_pack(downloaded: list[Downloaded], root: Path, output: Path) -> None:
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    manifest: list[dict[str, object]] = []
    category_counts: dict[str, int] = {}
    for index, item in enumerate(downloaded, start=1):
        category_counts[item.asset.category] = category_counts.get(item.asset.category, 0) + 1
        filename = f"{index:03d}_{item.asset.base_name}.{item.extension}"
        relative = Path(item.asset.category) / filename
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(item.data)
        manifest.append(
            {
                "index": index,
                "category": item.asset.category,
                "local_path": relative.as_posix(),
                "filename": filename,
                "bytes": len(item.data),
                "sha256": item.sha256,
                "quality_selected": item.width_hint,
                "intended_reference_use": item.asset.purpose,
                "downloaded_from": item.source_url,
                "official_preview_url": item.asset.preview_url,
                "official_original_candidate_url": item.asset.original_url,
                "source_page": MEDIA_PAGE,
                "copyright_holder": "Microsoft / Xbox Game Studios / Playground Games",
            }
        )

    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with (root / "manifest.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(manifest[0].keys()))
        writer.writeheader()
        writer.writerows(manifest)

    readme = f"""# Forza Horizon 6 Developer Reference Pack

This archive contains exactly **100 distinct official Forza Horizon 6 media images** collected from `{MEDIA_PAGE}` on {BUILD_DATE}.

## Platform accuracy

The request specified PlayStation 5. At the time this archive was assembled, the currently published official gallery material was not represented as a set of 100 PS5-specific gameplay captures. The images in this pack are therefore labeled as official FH6 media rather than falsely relabeled PS5 screenshots.

## Folder structure

- `01_Vehicles_Models` — bodywork, wheels, trim, materials, proportions and presentation.
- `02_Environments_World` — roads, architecture, terrain, foliage, density and composition.
- `03_Gameplay_Racing` — cameras, racing readability, speed cues, event framing and vehicle dynamics.
- `04_UI_Menu_Map` — menus, HUD, maps, progression and graphic-design language.
- `05_Lighting_Weather` — atmosphere, neon, reflections, weather and post-processing.
- `06_Garage_Customization` — garages, upgrades, customization and close-detail presentation.
- `07_Mixed_Reference` — supporting visual-direction references.

## Developer handoff files

- `manifest.csv` and `manifest.json` preserve the source URL, SHA-256 hash, category and intended use for every image.
- `contact-sheet.html` provides a browser-based visual index.
- `DEVELOPER_REFERENCE_GUIDE.md` explains how to translate the pack into original production work.

## Rights and permitted use

All images remain © Microsoft / Xbox Game Studios / Playground Games and their respective licensors. Use this pack for internal visual study and reference. Do not redistribute the images, present them as original work, extract or reuse proprietary game assets, trace protected liveries/logos, or ship these images inside a commercial game. Build original assets and obtain required vehicle, brand and location licences.
"""
    (root / "README.md").write_text(readme, encoding="utf-8")

    guide = """# Developer Reference Guide

## 1. Vehicle and 3D-model study

Use vehicle references to extract proportional relationships, surface breakups, panel-gap scale, wheel-to-body ratios, glass thickness, tire sidewall behavior, underbody shadowing and material separation. Do not copy a licensed vehicle without permission. Translate the observations into an original design language and create orthographic sheets before production modeling.

## 2. Environment production

Study road widths, shoulder transitions, curb profiles, drainage, guardrails, signage density, vegetation layering, skyline rhythm, landmark placement and the alternation between high-speed readability and close-range detail. Build a modular kit, establish texel-density standards, and prepare distance-based LODs and impostors.

## 3. Hyperrealistic materials and lighting

Match physical material behavior rather than merely matching color. Record roughness ranges, clear-coat response, anisotropy, glass absorption, tire sheen, wet-surface reflections, emissive intensity, atmospheric perspective and exposure behavior. Validate assets under neutral studio lighting before judging them in cinematic scenes.

## 4. Gameplay and camera design

Use racing images to study horizon placement, field of view, chase-camera lag, pitch response, corner anticipation, motion-blur restraint, speed-line cues, opponent readability and checkpoint framing. Prototype camera and handling separately from final art so visual polish does not conceal weak vehicle dynamics.

## 5. Menus, HUD and map design

Extract hierarchy, spacing, typographic scale, focus state, map contrast, route legibility, icon density and controller-navigation logic. Rebuild an original interface system rather than copying branded layouts. Every screen should pass controller-only navigation, 16:9 safe-area and accessibility contrast checks.

## 6. Production checklist

1. Convert observations into an original art bible and measurable technical targets.
2. Create blockouts and greybox gameplay before final-detail production.
3. Define polygon, material-slot, texture-memory and draw-call budgets per asset class.
4. Author LODs, collision meshes, lightmaps or runtime GI settings, and streaming rules.
5. Validate handling, cameras, UI and performance on target hardware continuously.
6. Run side-by-side reviews for lighting, materials, scale, gameplay clarity and frame-time stability.
"""
    (root / "DEVELOPER_REFERENCE_GUIDE.md").write_text(guide, encoding="utf-8")

    figures = "\n".join(
        f'<figure><img src="{row["local_path"]}" loading="lazy" alt="Reference {row["index"]}"><figcaption>{row["index"]:03d} · {row["category"]}<br>{row["intended_reference_use"]}</figcaption></figure>'
        for row in manifest
    )
    contact_sheet = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FH6 Reference Contact Sheet</title>
<style>body{{font-family:system-ui;background:#101216;color:#f2f4f8;margin:24px}}h1{{font-size:clamp(28px,5vw,58px)}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}}figure{{margin:0;background:#1b1f27;padding:10px;border-radius:12px}}img{{display:block;width:100%;height:auto;border-radius:8px}}figcaption{{font-size:12px;line-height:1.45;color:#c4ccda;margin-top:8px}}</style></head><body><h1>Forza Horizon 6 — 100 Developer References</h1><p>Official media organized for internal development study. See README.md for rights and platform labeling.</p><div class="grid">{figures}</div></body></html>"""
    (root / "contact-sheet.html").write_text(contact_sheet, encoding="utf-8")

    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, arcname=path.relative_to(root).as_posix())

    image_count = sum(
        1
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    if image_count != 100:
        raise RuntimeError(f"Expected exactly 100 images, found {image_count}")

    with zipfile.ZipFile(output, "r") as archive:
        bad_member = archive.testzip()
        if bad_member:
            raise RuntimeError(f"ZIP integrity test failed at {bad_member}")
        archived_images = [
            name for name in archive.namelist() if Path(name).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
        ]
        if len(archived_images) != 100:
            raise RuntimeError(f"ZIP contains {len(archived_images)} images instead of 100")

    print("Category counts:")
    for category, count in sorted(category_counts.items()):
        print(f"  {category}: {count}")
    print(f"Created {output} ({output.stat().st_size:,} bytes)")


def main() -> int:
    assets = discover_assets()
    print(f"Discovered {len(assets)} unique official FH6 image candidates")
    if len(assets) < 100:
        raise RuntimeError(f"Official media page exposed only {len(assets)} unique FH6 image candidates")

    ordered = balanced_order(assets)
    downloaded: list[Downloaded] = []
    hashes: set[str] = set()

    # Download in bounded batches so the pack can continue past unavailable CDN variants.
    for start in range(0, len(ordered), 24):
        batch = ordered[start : start + 24]
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(download_asset, batch))
        for result in results:
            if result is None or result.sha256 in hashes:
                continue
            hashes.add(result.sha256)
            downloaded.append(result)
            if len(downloaded) == 100:
                break
        print(f"Downloaded {len(downloaded)}/100 distinct images")
        if len(downloaded) == 100:
            break

    if len(downloaded) != 100:
        raise RuntimeError(f"Could download only {len(downloaded)} distinct images")

    write_pack(
        downloaded=downloaded,
        root=Path("build/fh6-reference-pack"),
        output=Path("build") / OUTPUT_NAME,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
