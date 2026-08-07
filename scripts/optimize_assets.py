"""Optimize PNG/WebP assets and prepare MP4 media for efficient web delivery."""

from __future__ import annotations

import argparse
import os
import struct
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class OptimizationResult:
    path: Path
    original_bytes: int
    optimized_bytes: int
    original_dimensions: tuple[int, int]
    optimized_dimensions: tuple[int, int]


@dataclass(frozen=True)
class Mp4OptimizationResult:
    path: Path
    original_bytes: int
    optimized_bytes: int
    moved_metadata: bool


def target_box(path: Path) -> tuple[int, int]:
    relative = path.relative_to(ROOT).as_posix()

    if relative in {
        "public/brand/bmai-logo-dark.png",
        "public/brand/bmai-logo-light.png",
    }:
        # The square AI marks render at 52px in the app and 512px in social
        # metadata. Keep a 512px lossless source for crisp high-density output.
        return (512, 512)
    if relative == "public/brand/busted-minds.webp":
        # This transparent powered-by wordmark is already a compact 256x117.
        return (256, 117)

    if relative == "public/promo-video-poster.png":
        # Native poster size for the 16:9 landing-page promo.
        return (1280, 720)
    if relative.startswith("public/emotes/") and path.suffix.lower() == ".webp":
        # Emotes render at 112px in matches and 76px in the picker. Retaining a
        # 320px source keeps high-density displays crisp without shipping the
        # much heavier 512px animation frames.
        return (320, 320)
    if relative.startswith("public/pieces/"):
        return (512, 512)
    if relative == "public/badges.png":
        # Nine square mission badges arranged in a 3x3 sprite sheet.
        return (1024, 1024)
    if relative == "public/mascot/nova-sprites.png":
        return (768, 768)
    if relative.startswith("public/avatars/rig-v1/"):
        return (768, 768)
    if relative.startswith("public/mascot/"):
        return (640, 960)
    if relative == "public/brand/busted-minds.png":
        return (512, 512)
    if relative == "public/brand/bustedminds-chess-logo-dark.png":
        return (768, 512)
    if relative == "public/brand/bustedminds-chess-logo-light.png":
        return (1200, 800)
    if relative.startswith("public/brand/"):
        return (512, 512)
    if relative.startswith("public/shop/"):
        return (512, 512)
    if relative == "src/app/icon.png":
        return (512, 512)

    # The full-width journey artwork is already appropriately sized; recompress
    # it without downscaling.
    return (10_000, 10_000)


def optimize_png(path: Path) -> OptimizationResult:
    original_bytes = path.stat().st_size

    with Image.open(path) as source:
        original_dimensions = source.size
        has_alpha = "A" in source.getbands() or "transparency" in source.info
        image = source.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail(target_box(path), Image.Resampling.LANCZOS)
        optimized_dimensions = image.size
        icc_profile = source.info.get("icc_profile")

    temporary_path = path.with_name(f"{path.name}.optimizing")
    save_options: dict[str, object] = {
        "format": "PNG",
        "optimize": True,
        "compress_level": 9,
    }
    if icc_profile:
        save_options["icc_profile"] = icc_profile

    image.save(temporary_path, **save_options)
    os.replace(temporary_path, path)

    return OptimizationResult(
        path=path,
        original_bytes=original_bytes,
        optimized_bytes=path.stat().st_size,
        original_dimensions=original_dimensions,
        optimized_dimensions=optimized_dimensions,
    )


def optimize_webp(path: Path) -> OptimizationResult:
    """Resize and recompress WebP assets while retaining animation metadata."""

    original_bytes = path.stat().st_size
    frames: list[Image.Image] = []
    durations: list[int] = []

    with Image.open(path) as source:
        original_dimensions = source.size
        loop = int(source.info.get("loop", 0))
        background = source.info.get("background")
        icc_profile = source.info.get("icc_profile")
        exif = source.info.get("exif")
        frame_count = getattr(source, "n_frames", 1)

        for frame_index in range(frame_count):
            source.seek(frame_index)
            frame = source.convert("RGBA")
            frame.thumbnail(target_box(path), Image.Resampling.LANCZOS)
            frames.append(frame.copy())
            durations.append(max(1, int(source.info.get("duration", 100))))

    optimized_dimensions = frames[0].size
    temporary_path = path.with_name(f"{path.name}.optimizing")
    save_options: dict[str, object] = {
        "format": "WEBP",
        "lossless": False,
        "quality": 92,
        "method": 5,
        "exact": True,
    }
    if len(frames) > 1:
        save_options.update({
            "save_all": True,
            "append_images": frames[1:],
            "duration": durations,
            "loop": loop,
            "allow_mixed": True,
        })
        if background is not None:
            save_options["background"] = background
    if icc_profile:
        save_options["icc_profile"] = icc_profile
    if exif:
        save_options["exif"] = exif

    frames[0].save(temporary_path, **save_options)
    optimized_bytes = temporary_path.stat().st_size
    if optimized_bytes < original_bytes or optimized_dimensions != original_dimensions:
        os.replace(temporary_path, path)
    else:
        temporary_path.unlink()
        optimized_bytes = original_bytes

    return OptimizationResult(
        path=path,
        original_bytes=original_bytes,
        optimized_bytes=optimized_bytes,
        original_dimensions=original_dimensions,
        optimized_dimensions=optimized_dimensions,
    )


def _read_box(data: bytes | bytearray, offset: int, limit: int) -> tuple[int, bytes, int]:
    if offset + 8 > limit:
        raise ValueError(f"Incomplete MP4 box header at byte {offset}")

    size = struct.unpack_from(">I", data, offset)[0]
    box_type = bytes(data[offset + 4 : offset + 8])
    header_size = 8

    if size == 1:
        if offset + 16 > limit:
            raise ValueError(f"Incomplete extended MP4 box header at byte {offset}")
        size = struct.unpack_from(">Q", data, offset + 8)[0]
        header_size = 16
    elif size == 0:
        size = limit - offset

    if size < header_size or offset + size > limit:
        name = box_type.decode("ascii", "replace")
        raise ValueError(f"Invalid {name!r} MP4 box at byte {offset}")

    return size, box_type, header_size


def _top_level_boxes(data: bytes) -> list[tuple[int, int, bytes]]:
    boxes: list[tuple[int, int, bytes]] = []
    offset = 0

    while offset < len(data):
        size, box_type, _ = _read_box(data, offset, len(data))
        boxes.append((offset, size, box_type))
        offset += size

    return boxes


MP4_CONTAINER_BOXES = {
    b"dinf",
    b"edts",
    b"mdia",
    b"minf",
    b"moov",
    b"mvex",
    b"stbl",
    b"trak",
    b"udta",
}


def _patch_chunk_offsets(
    data: bytearray,
    start: int,
    limit: int,
    *,
    insertion_offset: int,
    delta: int,
) -> int:
    """Shift media chunk offsets that move when the moov box is relocated."""

    patched_tables = 0
    offset = start

    while offset < limit:
        size, box_type, header_size = _read_box(data, offset, limit)
        content_start = offset + header_size
        box_limit = offset + size

        if box_type in {b"stco", b"co64"}:
            if content_start + 8 > box_limit:
                raise ValueError("Incomplete MP4 chunk-offset table")

            entry_count = struct.unpack_from(">I", data, content_start + 4)[0]
            entry_size = 4 if box_type == b"stco" else 8
            entries_start = content_start + 8
            entries_limit = entries_start + entry_count * entry_size
            if entries_limit > box_limit:
                raise ValueError("MP4 chunk-offset table exceeds its box boundary")

            format_code = ">I" if entry_size == 4 else ">Q"
            maximum = (1 << (entry_size * 8)) - 1
            for entry_offset in range(entries_start, entries_limit, entry_size):
                chunk_offset = struct.unpack_from(format_code, data, entry_offset)[0]
                if chunk_offset < insertion_offset:
                    continue
                shifted_offset = chunk_offset + delta
                if shifted_offset > maximum:
                    raise ValueError("MP4 chunk offset overflowed during fast-start preparation")
                struct.pack_into(format_code, data, entry_offset, shifted_offset)

            patched_tables += 1
        elif box_type in MP4_CONTAINER_BOXES:
            patched_tables += _patch_chunk_offsets(
                data,
                content_start,
                box_limit,
                insertion_offset=insertion_offset,
                delta=delta,
            )

        offset = box_limit

    return patched_tables


def optimize_mp4(path: Path) -> Mp4OptimizationResult:
    """Move an MP4's moov metadata before its media data without re-encoding."""

    original_bytes = path.stat().st_size
    data = path.read_bytes()
    boxes = _top_level_boxes(data)
    moov_boxes = [box for box in boxes if box[2] == b"moov"]
    mdat_boxes = [box for box in boxes if box[2] == b"mdat"]

    if len(moov_boxes) != 1 or not mdat_boxes:
        raise ValueError(f"Expected one moov box and at least one mdat box in {path}")

    moov_offset, moov_size, _ = moov_boxes[0]
    first_mdat_offset = mdat_boxes[0][0]
    if moov_offset < first_mdat_offset:
        return Mp4OptimizationResult(path, original_bytes, original_bytes, False)

    moov = bytearray(data[moov_offset : moov_offset + moov_size])
    _, _, moov_header_size = _read_box(moov, 0, len(moov))
    patched_tables = _patch_chunk_offsets(
        moov,
        moov_header_size,
        len(moov),
        insertion_offset=first_mdat_offset,
        delta=moov_size,
    )
    if patched_tables == 0:
        raise ValueError(f"No chunk-offset tables found in {path}")

    optimized = (
        data[:first_mdat_offset]
        + moov
        + data[first_mdat_offset:moov_offset]
        + data[moov_offset + moov_size :]
    )
    temporary_path = path.with_name(f"{path.name}.optimizing")
    temporary_path.write_bytes(optimized)
    os.replace(temporary_path, path)

    return Mp4OptimizationResult(path, original_bytes, path.stat().st_size, True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="Optional project-relative PNG, WebP, or MP4 paths to optimize.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.paths:
        targets = [(ROOT / path).resolve() if not path.is_absolute() else path.resolve() for path in args.paths]
        for target in targets:
            if not target.is_relative_to(ROOT):
                raise ValueError(f"Asset path must remain inside the project: {target}")
            if not target.is_file():
                raise FileNotFoundError(target)
    else:
        targets = sorted((ROOT / "public").rglob("*.png"))
        targets.extend(sorted((ROOT / "public").rglob("*.webp")))
        app_icon = ROOT / "src/app/icon.png"
        if app_icon.is_file():
            targets.append(app_icon)
        promo_video = ROOT / "public/promo-video.mp4"
        if promo_video.is_file():
            targets.append(promo_video)

    png_targets = [path for path in targets if path.suffix.lower() == ".png"]
    webp_targets = [path for path in targets if path.suffix.lower() == ".webp"]
    mp4_targets = [path for path in targets if path.suffix.lower() == ".mp4"]
    supported_targets = {*png_targets, *webp_targets, *mp4_targets}
    unsupported = [path for path in targets if path not in supported_targets]
    if unsupported:
        raise ValueError(f"Unsupported asset type: {unsupported[0]}")

    worker_count = min(4, os.cpu_count() or 1)
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        png_results = list(executor.map(optimize_png, png_targets))
        webp_results = list(executor.map(optimize_webp, webp_targets))
        results = sorted([*png_results, *webp_results], key=lambda item: item.path)

    mp4_results = [optimize_mp4(path) for path in mp4_targets]

    original_total = sum(result.original_bytes for result in results)
    optimized_total = sum(result.optimized_bytes for result in results)

    for result in results:
        relative = result.path.relative_to(ROOT).as_posix()
        before = f"{result.original_dimensions[0]}x{result.original_dimensions[1]}"
        after = f"{result.optimized_dimensions[0]}x{result.optimized_dimensions[1]}"
        print(
            f"{relative}: {before} -> {after}, "
            f"{result.original_bytes / 1024:.1f} KiB -> "
            f"{result.optimized_bytes / 1024:.1f} KiB"
        )

    if results:
        reduction = 1 - (optimized_total / original_total)
        print(
            f"Optimized {len(results)} raster assets: "
            f"{original_total / 1024 / 1024:.2f} MiB -> "
            f"{optimized_total / 1024 / 1024:.2f} MiB "
            f"({reduction:.1%} smaller)"
        )

    for result in mp4_results:
        relative = result.path.relative_to(ROOT).as_posix()
        action = "moved metadata before media" if result.moved_metadata else "already fast-start ready"
        print(
            f"{relative}: {result.original_bytes / 1024:.1f} KiB -> "
            f"{result.optimized_bytes / 1024:.1f} KiB ({action})"
        )


if __name__ == "__main__":
    main()
