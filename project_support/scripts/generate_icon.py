from __future__ import annotations

import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RESOURCES = ROOT / "project_support" / "resources"
SIZES = (16, 24, 32, 48, 64, 128, 256)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def png_bytes(size: int) -> bytes:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            radius = size * 0.18
            inside = (
                (x >= radius or y >= radius or (x - radius) ** 2 + (y - radius) ** 2 <= radius**2)
                and (x <= size - radius or y >= radius or (x - (size - radius)) ** 2 + (y - radius) ** 2 <= radius**2)
                and (x >= radius or y <= size - radius or (x - radius) ** 2 + (y - (size - radius)) ** 2 <= radius**2)
                and (x <= size - radius or y <= size - radius or (x - (size - radius)) ** 2 + (y - (size - radius)) ** 2 <= radius**2)
            )
            if not inside:
                row.extend((0, 0, 0, 0))
                continue
            # WeChat-inspired green tile with a simple white W mark.
            green = (7, 193, 96, 255)
            white = (255, 255, 255, 255)
            w_band = size * 0.1
            left = abs(x - (size * 0.30)) < w_band and size * 0.28 < y < size * 0.73
            right = abs(x - (size * 0.70)) < w_band and size * 0.28 < y < size * 0.73
            mid_left = abs((x - size * 0.30) - (size * 0.20 - abs(y - size * 0.63))) < w_band and y > size * 0.46
            mid_right = abs((size * 0.70 - x) - (size * 0.20 - abs(y - size * 0.63))) < w_band and y > size * 0.46
            row.extend(white if left or right or mid_left or mid_right else green)
        rows.append(bytes(row))

    raw = b"".join(rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    RESOURCES.mkdir(parents=True, exist_ok=True)
    images = [(size, png_bytes(size)) for size in SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    directory = bytearray()
    payload = bytearray()
    offset = 6 + 16 * len(images)
    for size, data in images:
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                0 if size == 256 else size,
                0 if size == 256 else size,
                0,
                0,
                1,
                32,
                len(data),
                offset,
            )
        )
        payload.extend(data)
        offset += len(data)

    (RESOURCES / "icon.ico").write_bytes(header + directory + payload)
    (RESOURCES / "icon.png").write_bytes(images[-1][1])


if __name__ == "__main__":
    main()
