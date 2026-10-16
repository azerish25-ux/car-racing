#!/usr/bin/env python3
"""Build a high-resolution, source-traceable motocross-game image candidate pack.

This script is intentionally research-oriented. It gathers official storefront and
publisher screenshots plus frames from official Steam-hosted trailers. Every image
keeps a source URL in the manifest. The resulting material is for visual reference;
it does not transfer any rights to the underlying artwork.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass, asdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import imagehash
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat

Image.MAX_IMAGE_PIXELS = 80_000_000

ROOT = Path("motocross_reference_build")
IMAGES = ROOT / "candidates"
SHEETS = ROOT / "contact_sheets"
VIDEOS = ROOT / "videos"
TEMP = ROOT / "temp"
for folder in (ROOT, IMAGES, SHEETS, VIDEOS, TEMP):
    folder.mkdir(parents=True, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
    ),
    "Accept-Language": "en-CA,en;q=0.9",
})

MAX_IMAGES = 260
MIN_WIDTH = 800
MIN_HEIGHT = 440
REQUEST_TIMEOUT = 35

GAMES = [
    {
        "short": "SX25",
        "title": "Monster Energy Supercross 25 - The Official Video Game",
        "search": "Monster Energy Supercross 25 The Official Video Game",
        "platform": "PS5",
    },
    {
        "short": "MXATV",
        "title": "MX vs ATV Legends",
        "search": "MX vs ATV Legends",
        "platform": "PS5",
    },
    {
        "short": "SX6",
        "title": "Monster Energy Supercross - The Official Videogame 6",
        "search": "Monster Energy Supercross The Official Videogame 6",
        "platform": "PS5",
    },
    {
        "short": "MXGP21",
        "title": "MXGP 2021 - The Official Motocross Videogame",
        "search": "MXGP 2021 The Official Motocross Videogame",
        "platform": "PS5",
    },
    {
        "short": "SX5",
        "title": "Monster Energy Supercross - The Official Videogame 5",
        "search": "Monster Energy Supercross The Official Videogame 5",
        "platform": "PS5",
    },
    {
        "short": "SX4",
        "title": "Monster Energy Supercross - The Official Videogame 4",
        "search": "Monster Energy Supercross The Official Videogame 4",
        "platform": "PS5",
    },
]

BASE_PAGES: list[tuple[str, str, str]] = [
    ("MXATV", "official_site", "https://mxvsatvlegends.thqnordic.com/"),
    ("MXATV", "official_media", "https://media.thqnordic.com/s/all?path=/MX_vs_ATV-Legends"),
    ("MXATV", "playstation", "https://www.playstation.com/en-us/games/mx-vs-atv-legends/"),
    ("SX25", "playstation", "https://www.playstation.com/en-cz/games/monster-energy-supercross-25-the-official-video-game/"),
    ("SX25", "milestone", "https://milestone.it/news/supercross-25/gameplay-showcase/"),
    ("SX25", "review_gallery", "https://gamingtrend.com/reviews/monster-energy-supercross-25-review-a-great-game-hindered-by-weird-control-choices/"),
    ("SX25", "screenshot_gallery", "https://www.gamegrin.com/directory/game/monster-energy-supercross-25-the-official-video-game/images"),
    ("SX6", "playstation", "https://www.playstation.com/en-us/games/monster-energy-supercross-the-official-videogame-6/"),
    ("SX6", "official_press", "https://presse.plaion.com/Monster-Energy-Supercross---The-Official-Videogame-6"),
    ("MXGP21", "playstation", "https://www.playstation.com/en-us/games/mxgp-2021/"),
    ("MXGP21", "screenshot_gallery", "https://www.gamegrin.com/directory/game/mxgp-2021-the-official-motocross-videogame/images"),
    ("MXATV", "screenshot_gallery", "https://www.gamegrin.com/directory/game/mx-vs-atv-legends/images"),
    ("MXATV", "menu_environment", "https://gvaldes.artstation.com/projects/obyV0O"),
]

# Gallery pages with stable numbered URLs. These largely mirror publisher-supplied
# screenshots and provide useful high-resolution fallback sources.
for n in range(1, 22):
    BASE_PAGES.append(("SX6", "press_gallery", f"https://kotaku.com/games/monster-energy-supercross-6-the-official-videogame/gallery/{n}"))
for n in range(1, 11):
    BASE_PAGES.append(("MXGP21", "press_gallery", f"https://kotaku.com/games/mxgp-2021/gallery/{n}"))
for slug, count in [
    ("mx-vs-atv-legends-slayground", 7),
    ("mx-vs-atv-legends-icon-pack", 9),
    ("mx-vs-atv-legends-ultimate-edition", 7),
    ("mx-vs-atv-legends-customization-pack", 2),
    ("mx-vs-atv-legends-2024-ama-pro-motocross-championship", 3),
]:
    for n in range(1, count + 1):
        BASE_PAGES.append(("MXATV", "press_gallery", f"https://kotaku.com/games/{slug}/gallery/{n}"))

KNOWN_IMAGES: list[tuple[str, str, str, str]] = [
    (
        "SX25",
        "official_screenshot",
        "https://milestone.it/wp-content/uploads/2025/01/SX25_Screenshot_GameplayShowcase_NoLogo_05-scaled.jpg",
        "https://milestone.it/news/supercross-25/gameplay-showcase/",
    ),
    (
        "SX25",
        "review_screenshot",
        "https://storage.ghost.io/c/50/c6/50c61f91-0165-4605-93bc-f8598149e466/content/images/size/w1200/2025/06/SX25_CareerExplosion_Screenshot_Logo--11-.jpg",
        "https://gamingtrend.com/reviews/monster-energy-supercross-25-review-a-great-game-hindered-by-weird-control-choices/",
    ),
]
for n in range(1, 21):
    KNOWN_IMAGES.append((
        "MXATV",
        "official_screenshot_pattern",
        f"https://mxvsatvlegends.thqnordic.com/game-sites/mxvsatvlegends/content/screenshots/screenshot-{n:02d}.png",
        "https://mxvsatvlegends.thqnordic.com/",
    ))

BAD_URL_PARTS = (
    "favicon", "cookie", "pixel", "tracking", "analytics", "avatar",
    "rating", "esrb", "pegi", "spinner", "loader", "placeholder",
    "social-icon", "social_icon", "apple-touch", "sprite", "blank.gif",
)
IMAGE_EXT_RE = re.compile(r"\.(?:jpe?g|png|webp)(?:$|[?#])", re.I)
ABS_IMAGE_RE = re.compile(
    r"https?://[^\s\"'<>\\]+?\.(?:jpe?g|png|webp)(?:\?[^\s\"'<>\\]*)?",
    re.I,
)


@dataclass
class Record:
    id: int
    file: str
    game: str
    platform: str
    source_kind: str
    source_url: str
    source_page: str
    timestamp_seconds: str
    width: int
    height: int
    sha256: str
    phash: str


records: list[Record] = []
seen_sha: set[str] = set()
seen_phash: list[imagehash.ImageHash] = []
failed: list[dict[str, str]] = []
video_sources: list[dict[str, str]] = []
image_candidates: list[dict[str, str]] = []
seen_candidate_urls: set[str] = set()

GAME_BY_SHORT = {g["short"]: g for g in GAMES}


def safe_get(url: str, *, stream: bool = False, timeout: int = REQUEST_TIMEOUT) -> requests.Response:
    response = SESSION.get(url, timeout=timeout, stream=stream, allow_redirects=True)
    response.raise_for_status()
    return response


def clean_url(raw: str, page_url: str) -> str | None:
    raw = (raw or "").strip().replace("&amp;", "&")
    if not raw or raw.startswith(("data:", "blob:", "javascript:")):
        return None
    # Decode Next.js image optimizer URLs back to the original asset.
    absolute = urljoin(page_url, raw)
    parsed = urlparse(absolute)
    if parsed.path.endswith("/_next/image") or parsed.path == "/_next/image":
        target = parse_qs(parsed.query).get("url", [""])[0]
        if target:
            absolute = urljoin(f"{parsed.scheme}://{parsed.netloc}", unquote(target))
    absolute = absolute.replace("\\u0026", "&").replace("\\/", "/")
    if not absolute.startswith(("http://", "https://")):
        return None
    lower = absolute.lower()
    if any(part in lower for part in BAD_URL_PARTS):
        return None
    if not IMAGE_EXT_RE.search(absolute):
        # PlayStation and a few CDNs omit extensions after transforms; retain known image CDNs.
        allowed_cdn = ("image.api.playstation.com", "images.ctfassets.net", "i.kinja-img.com")
        if not any(host in lower for host in allowed_cdn):
            return None
    return absolute


def add_candidate(game: str, kind: str, url: str, page: str) -> None:
    cleaned = clean_url(url, page)
    if not cleaned or cleaned in seen_candidate_urls:
        return
    seen_candidate_urls.add(cleaned)
    image_candidates.append({"game": game, "kind": kind, "url": cleaned, "page": page})


def scrape_page(game: str, kind: str, page_url: str) -> None:
    try:
        response = safe_get(page_url)
        html = response.text
        soup = BeautifulSoup(html, "html.parser")
        attrs = ("src", "data-src", "data-original", "data-lazy-src", "data-image", "content")
        for tag in soup.find_all(["img", "source", "meta", "a"]):
            for attr in attrs:
                value = tag.get(attr)
                if value:
                    add_candidate(game, kind, value, page_url)
            for attr in ("srcset", "data-srcset"):
                value = tag.get(attr)
                if value:
                    for part in value.split(","):
                        add_candidate(game, kind, part.strip().split(" ")[0], page_url)
            href = tag.get("href")
            if href and IMAGE_EXT_RE.search(href):
                add_candidate(game, kind, href, page_url)
        for match in ABS_IMAGE_RE.findall(html.replace("\\/", "/")):
            add_candidate(game, kind, match, page_url)
        # Pull escaped image URLs from Next.js/React JSON payloads.
        for match in re.findall(r'(?:url|src|image)[\\\"\'=: ]+(https?:[^\\\"\'<> ]+)', html, re.I):
            add_candidate(game, kind, match.replace("\\/", "/"), page_url)
    except Exception as exc:  # keep the rest of the build productive
        failed.append({"stage": "scrape", "url": page_url, "error": str(exc)[:300]})


def title_score(query: str, title: str) -> float:
    q = re.sub(r"[^a-z0-9]+", " ", query.lower()).strip()
    t = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    ratio = SequenceMatcher(None, q, t).ratio()
    q_tokens = set(q.split())
    t_tokens = set(t.split())
    overlap = len(q_tokens & t_tokens) / max(1, len(q_tokens))
    return ratio * 0.55 + overlap * 0.45


def discover_steam_assets() -> None:
    for game in GAMES:
        try:
            search_url = (
                "https://store.steampowered.com/api/storesearch/"
                f"?term={quote_plus(game['search'])}&l=english&cc=CA"
            )
            items = safe_get(search_url).json().get("items", [])
            if not items:
                raise RuntimeError("Steam search returned no items")
            best = max(items, key=lambda item: title_score(game["search"], item.get("name", "")))
            if title_score(game["search"], best.get("name", "")) < 0.50:
                raise RuntimeError(f"Steam title match too weak: {best.get('name')}")
            appid = str(best["id"])
            details_url = f"https://store.steampowered.com/api/appdetails?appids={appid}&l=english&cc=CA"
            payload = safe_get(details_url).json()
            block = payload.get(appid, {})
            if not block.get("success"):
                raise RuntimeError(f"Steam appdetails failed for {appid}")
            data = block["data"]
            page = f"https://store.steampowered.com/app/{appid}/"
            for shot in data.get("screenshots", []):
                url = shot.get("path_full") or shot.get("path_thumbnail")
                if url:
                    add_candidate(game["short"], "steam_official_screenshot", url, page)
            for movie in data.get("movies", [])[:2]:
                mp4 = movie.get("mp4", {})
                url = mp4.get("max") or mp4.get("480")
                if url:
                    video_sources.append({
                        "game": game["short"],
                        "kind": "steam_official_trailer",
                        "url": url,
                        "page": page,
                        "name": movie.get("name", "Official trailer"),
                    })
            for key in ("header_image", "background_raw"):
                url = data.get(key)
                if url:
                    add_candidate(game["short"], "steam_key_art", url, page)
            print(f"Steam: {game['short']} -> app {appid}, {len(data.get('screenshots', []))} screenshots")
        except Exception as exc:
            failed.append({"stage": "steam", "url": game["search"], "error": str(exc)[:300]})


def image_to_jpeg_bytes(image: Image.Image) -> tuple[bytes, Image.Image]:
    image = ImageOps.exif_transpose(image).convert("RGB")
    if image.width > 2560 or image.height > 1440:
        image.thumbnail((2560, 1440), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=91, optimize=True, progressive=True)
    return buffer.getvalue(), image


def is_visually_useful(image: Image.Image) -> bool:
    if image.width < MIN_WIDTH or image.height < MIN_HEIGHT:
        return False
    aspect = image.width / max(1, image.height)
    if aspect < 1.15 or aspect > 2.65:
        return False
    thumb = image.convert("L").resize((128, 72))
    stats = ImageStat.Stat(thumb)
    return stats.stddev[0] >= 12 and 6 < stats.mean[0] < 249


def add_image_bytes(
    content: bytes,
    *,
    game: str,
    kind: str,
    source_url: str,
    source_page: str,
    timestamp: str = "",
) -> bool:
    if len(records) >= MAX_IMAGES:
        return False
    try:
        with Image.open(io.BytesIO(content)) as opened:
            opened.load()
            if not is_visually_useful(opened):
                return False
            jpeg, normalized = image_to_jpeg_bytes(opened)
            digest = hashlib.sha256(jpeg).hexdigest()
            if digest in seen_sha:
                return False
            ph = imagehash.phash(normalized)
            if any((ph - old) <= 2 for old in seen_phash):
                return False
            idx = len(records) + 1
            game_info = GAME_BY_SHORT.get(game, {"platform": "PS5"})
            safe_kind = re.sub(r"[^a-z0-9]+", "_", kind.lower()).strip("_")[:30]
            filename = f"{idx:04d}_{game.lower()}_{safe_kind}.jpg"
            path = IMAGES / filename
            path.write_bytes(jpeg)
            seen_sha.add(digest)
            seen_phash.append(ph)
            records.append(Record(
                id=idx,
                file=f"candidates/{filename}",
                game=game,
                platform=game_info.get("platform", "PS5"),
                source_kind=kind,
                source_url=source_url,
                source_page=source_page,
                timestamp_seconds=timestamp,
                width=normalized.width,
                height=normalized.height,
                sha256=digest,
                phash=str(ph),
            ))
            return True
    except Exception as exc:
        failed.append({"stage": "decode", "url": source_url, "error": str(exc)[:300]})
        return False


def download_images() -> None:
    for index, item in enumerate(image_candidates, start=1):
        if len(records) >= 175:  # reserve room for varied trailer frames
            break
        try:
            response = safe_get(item["url"], timeout=28)
            ctype = response.headers.get("content-type", "").lower()
            if "image" not in ctype and not IMAGE_EXT_RE.search(item["url"]):
                continue
            if len(response.content) < 30_000:
                continue
            added = add_image_bytes(
                response.content,
                game=item["game"],
                kind=item["kind"],
                source_url=response.url,
                source_page=item["page"],
            )
            if added and len(records) % 20 == 0:
                print(f"Accepted {len(records)} still images ({index}/{len(image_candidates)} candidates checked)")
        except Exception as exc:
            failed.append({"stage": "download", "url": item["url"], "error": str(exc)[:300]})


def command_output(command: list[str]) -> str:
    return subprocess.check_output(command, stderr=subprocess.STDOUT, text=True).strip()


def extract_video_frames() -> None:
    per_game_movies: dict[str, int] = {}
    for source in video_sources:
        if len(records) >= MAX_IMAGES:
            break
        used = per_game_movies.get(source["game"], 0)
        if used >= 1:
            continue
        per_game_movies[source["game"]] = used + 1
        video_path = VIDEOS / f"{source['game'].lower()}_{used + 1}.mp4"
        try:
            with safe_get(source["url"], stream=True, timeout=50) as response:
                with video_path.open("wb") as handle:
                    for chunk in response.iter_content(1024 * 1024):
                        if chunk:
                            handle.write(chunk)
            duration_text = command_output([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(video_path),
            ])
            duration = float(duration_text)
            if duration < 8:
                raise RuntimeError(f"Trailer duration too short: {duration}")
            # Uniform coverage captures bikes, riders, terrain, cameras, editors and title UI.
            fractions = [0.055 + i * (0.89 / 17) for i in range(18)]
            for frame_no, fraction in enumerate(fractions, start=1):
                if len(records) >= MAX_IMAGES:
                    break
                timestamp = min(duration - 0.25, max(0.25, duration * fraction))
                frame_path = TEMP / f"{source['game'].lower()}_{frame_no:02d}.jpg"
                subprocess.run([
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", f"{timestamp:.3f}", "-i", str(video_path),
                    "-frames:v", "1", "-vf",
                    "scale='min(1920,iw)':-2:flags=lanczos", "-q:v", "2", str(frame_path),
                ], check=True)
                if frame_path.exists():
                    add_image_bytes(
                        frame_path.read_bytes(),
                        game=source["game"],
                        kind=source["kind"],
                        source_url=source["url"],
                        source_page=source["page"],
                        timestamp=f"{timestamp:.3f}",
                    )
                    frame_path.unlink(missing_ok=True)
            print(f"Frames: {source['game']} trailer processed; total accepted {len(records)}")
        except Exception as exc:
            failed.append({"stage": "video", "url": source["url"], "error": str(exc)[:300]})
        finally:
            video_path.unlink(missing_ok=True)


def write_manifest() -> None:
    fieldnames = list(asdict(records[0]).keys()) if records else [
        "id", "file", "game", "platform", "source_kind", "source_url",
        "source_page", "timestamp_seconds", "width", "height", "sha256", "phash",
    ]
    with (ROOT / "manifest.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow(asdict(record))
    with (ROOT / "failed_sources.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["stage", "url", "error"])
        writer.writeheader()
        writer.writerows(failed)


def create_contact_sheets() -> None:
    font = ImageFont.load_default()
    tile_w, tile_h, label_h = 384, 216, 30
    cols, rows = 5, 4
    per_sheet = cols * rows
    for sheet_index in range(math.ceil(len(records) / per_sheet)):
        subset = records[sheet_index * per_sheet:(sheet_index + 1) * per_sheet]
        canvas = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#161616")
        draw = ImageDraw.Draw(canvas)
        for pos, record in enumerate(subset):
            image = Image.open(ROOT / record.file).convert("RGB")
            thumb = ImageOps.fit(image, (tile_w, tile_h), method=Image.Resampling.LANCZOS)
            x = (pos % cols) * tile_w
            y = (pos // cols) * (tile_h + label_h)
            canvas.paste(thumb, (x, y))
            label = f"{record.id:04d}  {record.game}  {record.source_kind[:27]}"
            draw.rectangle((x, y + tile_h, x + tile_w, y + tile_h + label_h), fill="#111111")
            draw.text((x + 7, y + tile_h + 8), label, fill="#f2f2f2", font=font)
        canvas.save(SHEETS / f"contact_sheet_{sheet_index + 1:02d}.jpg", quality=88, optimize=True)


def write_readme() -> None:
    counts: dict[str, int] = {}
    for record in records:
        counts[record.game] = counts.get(record.game, 0) + 1
    lines = [
        "PS5 MOTOCROSS GAME REFERENCE CANDIDATES",
        "========================================",
        "",
        f"Candidate images: {len(records)}",
        "",
        "Purpose",
        "-------",
        "A source-traceable visual research pool for selecting a final 100-image developer pack.",
        "The material covers motorcycle and rider models, gear, stadium and outdoor terrain,",
        "camera language, HUD, customization/editor surfaces, lighting, dirt, dust and weather.",
        "",
        "Game distribution",
        "-----------------",
    ]
    for game, count in sorted(counts.items()):
        lines.append(f"- {game}: {count}")
    lines += [
        "",
        "Files",
        "-----",
        "- candidates/: normalized high-resolution JPEG images",
        "- contact_sheets/: numbered review sheets",
        "- manifest.csv: source URL, page, timestamp (for video frames), dimensions and hashes",
        "- failed_sources.csv: non-fatal retrieval failures for auditability",
        "",
        "Rights notice",
        "-------------",
        "Reference use only. Images remain the property of their respective publishers, studios,",
        "platforms and credited creators. This compilation does not grant redistribution, trademark,",
        "character, livery, sponsor or commercial-use rights. Do not ship copied textures, logos,",
        "models or UI. Use the pack to study proportions, material response, composition and systems.",
        "",
    ]
    (ROOT / "README_FIRST.txt").write_text("\n".join(lines), encoding="utf-8")


def make_zip() -> Path:
    out = ROOT / "motocross_ps5_reference_candidates.zip"
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file() or path == out or path.parent in (VIDEOS, TEMP):
                continue
            archive.write(path, path.relative_to(ROOT))
    return out


def main() -> int:
    print("Discovering Steam storefront media...")
    discover_steam_assets()
    print(f"Steam supplied {len(image_candidates)} image URLs and {len(video_sources)} videos")

    for game, kind, url, page in KNOWN_IMAGES:
        add_candidate(game, kind, url, page)

    print(f"Scraping {len(BASE_PAGES)} curated pages...")
    for idx, (game, kind, page) in enumerate(BASE_PAGES, start=1):
        scrape_page(game, kind, page)
        if idx % 15 == 0:
            print(f"Scraped {idx}/{len(BASE_PAGES)} pages; {len(image_candidates)} unique image URLs")
        time.sleep(0.08)

    print(f"Downloading from {len(image_candidates)} unique image candidates...")
    download_images()
    print(f"Accepted {len(records)} unique still images; extracting trailer frames...")
    extract_video_frames()

    write_manifest()
    create_contact_sheets()
    write_readme()
    report = {
        "accepted_images": len(records),
        "candidate_urls": len(image_candidates),
        "video_sources": len(video_sources),
        "failed_operations": len(failed),
        "by_game": {g: sum(1 for r in records if r.game == g) for g in sorted({r.game for r in records})},
    }
    (ROOT / "build_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    out = make_zip()
    print(json.dumps(report, indent=2))
    print(f"Wrote {out} ({out.stat().st_size / 1024 / 1024:.1f} MiB)")
    if len(records) < 115:
        print("ERROR: fewer than 115 unique candidates; refusing to publish an undersized pool", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
