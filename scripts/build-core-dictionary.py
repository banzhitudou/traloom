#!/usr/bin/env python3
"""Build the compact offline reader dictionary from ECDICT's official CSV."""

import csv
import json
import re
import sys
from pathlib import Path


WORD_PATTERN = re.compile(r"^[A-Za-z][A-Za-z'-]{1,39}$")


def number(value: str) -> int:
    try:
        return int(value or 0)
    except ValueError:
        return 0


def brief_translation(value: str) -> str:
    lines = re.split(r"\\n|\n", value or "")
    useful = []
    for line in lines:
        text = re.sub(r"\s+", " ", line).strip()
        if not text or text.startswith("[网络]"):
            continue
        if text not in useful:
            useful.append(text)
        if len(useful) == 2:
            break
    result = "；".join(useful)
    return result[:177] + "..." if len(result) > 180 else result


def build(source: Path, destination: Path) -> None:
    csv.field_size_limit(sys.maxsize)
    entries = {}
    with source.open("r", encoding="utf-8", newline="") as source_file:
        for row in csv.DictReader(source_file):
            word = row["word"].strip()
            translation = brief_translation(row["translation"])
            if not WORD_PATTERN.fullmatch(word) or not translation:
                continue

            collins = number(row["collins"])
            oxford = number(row["oxford"])
            bnc = number(row["bnc"])
            frequency = number(row["frq"])
            tagged = bool(row["tag"].strip())
            is_core = (
                bool(oxford)
                or bool(collins)
                or tagged
                or 0 < bnc <= 40000
                or 0 < frequency <= 40000
            )
            if not is_core:
                continue

            ranks = [rank for rank in (bnc, frequency) if rank > 0]
            rank = min(ranks) if ranks else 99999
            key = word.lower()
            candidate = [
                row["phonetic"].strip(),
                translation,
                rank,
                collins,
                oxford,
                row["pos"].strip(),
            ]
            existing = entries.get(key)
            if existing is None or (oxford, collins, -rank) > (existing[4], existing[3], -existing[2]):
                entries[key] = candidate

    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "source": "https://github.com/skywind3000/ECDICT",
        "entries": entries,
    }
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {len(entries)} entries to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-core-dictionary.py SOURCE.csv DESTINATION.json")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
