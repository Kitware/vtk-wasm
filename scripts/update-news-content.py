#!/usr/bin/env python3
"""Draft docs/news.md changelog entries from recently merged VTK MRs.

Fetches merged MRs from the vtk/vtk GitLab project, filters them to the
topics tracked in the WASM changelog (wasm, webgl2, webgpu, serialization /
marshalling), asks an LLM to paraphrase each one into a tone-compliant entry
matching the existing style of docs/news.md, and inserts the drafted
entries into news.md sorted by the MR's merged date, in the correct
chronological slot among the existing release headings and content entries -
for human review.

This script never commits on its own and never invents MR numbers or links -
each entry is generated from, and linked to, the single MR it was drafted
from.

Usage:
    python scripts/update-news-content.py [--dry-run] [--since YYYY-MM-DD] [--until YYYY-MM-DD]

Environment:
    GL_VTK_VTK_TOKEN / GITLAB_TOKEN / GL_TOKEN / PRIVATE_TOKEN
        GitLab personal access token with read access to vtk/vtk (optional
        for public read-only endpoints, but avoids rate limiting).
    ANTHROPIC_API_KEY
        Anthropic API key used to paraphrase MR descriptions.

Requires the `anthropic` package: pip install anthropic
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
NEWS_PATH = REPO_ROOT / "docs" / "news.md"
GITLAB_HOST = "gitlab.kitware.com"
PROJECT_PATH = "vtk/vtk"

ANTHROPIC_MODEL = "claude-opus-5"

# Topics this changelog tracks. Matched case-insensitively against MR labels
# first, falling back to the MR title when labels don't carry the topic.
TOPIC_KEYWORDS = ("wasm", "webgl2", "webgpu", "serdes", "serialization", "marshalling", "marshaling")

_HEADING_RE = re.compile(r"^## .+$", re.MULTILINE)

TONE_RULES = """\
Tone rules for VTK.wasm changelog entries (follow exactly):

1. Active voice. Bad: "A function to X was added to VTK." Good: "VTK now provides function X."
2. Write to the reader, not about them. Bad: "Users can now do X with Y." Good: "You can now do X with filter Y."
3. Never refer to "this MR" or "the current commit". Refer to the VTK merge request directly by its
   `vtk/vtk!XXXX` link, e.g. "See [vtk/vtk!13653](https://gitlab.kitware.com/vtk/vtk/-/merge_requests/13653) for details."
   Only ever use the MR number and URL you are given below - never invent one.
4. Class names in body prose are wrapped in backticks, e.g. `vtkCompositeDataDisplayAttributes`.
5. Module names in body prose are italicized, e.g. _RenderingCore_.
6. Keep the body to 1-3 sentences. Optionally end with a "See [vtk/vtk!XXXX](url) for details." link.
   Use a numbered or bulleted list only if you are enumerating several classes/modules, as in example 2.
7. The date line uses the MR's merged date, formatted exactly as __Month DD, YYYY__ (zero-padded day,
   e.g. __September 08, 2026__).
8. The heading is a short, specific, active-voice title for the change (no trailing period).

Few-shot examples of the exact target style, drawn from the existing changelog:

---
## Support vtkLODProp3D in webgl2 backend

__September 19, 2026__

You can now use the `vtkLODProp3D` class for level-of-detail rendering with the webgl2
backend.
---
## Enable serdes for a selection of classes in RenderingCore and RenderingImage modules

__September 08, 2026__

You can now serialize classes in VTK::RenderingCore:

1. vtkAssembly
2. vtkAssemblyPaths
3. vtkAvatar
---
## Fix deserialization of composite data display attributes

__September 08, 2026__

The deserialization of `vtkCompositeDataDisplayAttributes` now works as expected. Previously,
state changes in per-block display attributes, such as block visibility, were not applied correctly.
See [vtk/vtk!13653](https://gitlab.kitware.com/vtk/vtk/-/merge_requests/13653) for details.
---
## Fix rendering of thick lines in vtkGlyph3DMapper under webgl2 backend

__September 10, 2026__

The vtkGlyph3DMapper now features improved rendering of lines >1px in the webgl2 backend.
See [vtk/vtk!13672](https://gitlab.kitware.com/vtk/vtk/-/merge_requests/13672) for details.
---

Output ONLY the entry as markdown: a "## Title" heading line, a blank line, the
"__Month DD, YYYY__" date line, a blank line, then the body. No preamble, no
commentary, no code fences around the whole thing.
"""


# ---------------------------------------------------------------------------
# GitLab API layer (mirrors scripts/update-news.py's dispatch/fallback chain)
# ---------------------------------------------------------------------------

def _get_token() -> str | None:
    for var in ("GL_VTK_VTK_TOKEN", "GITLAB_TOKEN", "GL_TOKEN", "PRIVATE_TOKEN"):
        val = os.environ.get(var)
        if val:
            return val
    return None


def _api_call_glab(endpoint: str) -> list | dict:
    result = subprocess.run(
        ["glab", "api", "--hostname", GITLAB_HOST, "--paginate", endpoint],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def _api_call_urllib(endpoint: str, token: str | None) -> list | dict:
    results = []
    page = 1
    while True:
        sep = "&" if "?" in endpoint else "?"
        url = f"https://{GITLAB_HOST}/api/v4/{endpoint}{sep}page={page}&per_page=100"
        req = urllib.request.Request(url)
        if token:
            req.add_header("PRIVATE-TOKEN", token)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            if isinstance(data, list):
                results.extend(data)
                next_page = resp.headers.get("X-Next-Page", "")
                if not next_page or not data:
                    break
                page = int(next_page)
            else:
                return data
    return results


def _api_call_curl(endpoint: str, token: str | None) -> list | dict:
    url = f"https://{GITLAB_HOST}/api/v4/{endpoint}"
    cmd = ["curl", "-s", "--fail"]
    if token:
        cmd += ["-H", f"PRIVATE-TOKEN: {token}"]
    cmd.append(url)
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def api_call(endpoint: str) -> list | dict:
    """Dispatch GitLab API call: glab -> urllib -> curl. Auto-paginates (glab
    --paginate / urllib's X-Next-Page loop) - only safe for endpoints where
    the full result set is small (e.g. the package registry). For anything
    that can be large (like project-wide merge requests), use
    fetch_page_bounded instead, which fetches exactly one page per call.
    """
    token = _get_token()

    if shutil.which("glab"):
        try:
            return _api_call_glab(endpoint)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
            print(f"WARNING: glab API call failed ({e}), falling back to urllib", file=sys.stderr)

    try:
        return _api_call_urllib(endpoint, token)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"WARNING: urllib API call failed ({e}), falling back to curl", file=sys.stderr)

    try:
        return _api_call_curl(endpoint, token)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print(f"ERROR: All API methods failed. Last error: {e}", file=sys.stderr)
        sys.exit(1)


def _fetch_page_glab(endpoint: str) -> list | dict:
    result = subprocess.run(
        ["glab", "api", "--hostname", GITLAB_HOST, endpoint],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def _fetch_page_urllib(endpoint: str, token: str | None) -> list | dict:
    req = urllib.request.Request(f"https://{GITLAB_HOST}/api/v4/{endpoint}")
    if token:
        req.add_header("PRIVATE-TOKEN", token)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _fetch_page_curl(endpoint: str, token: str | None) -> list | dict:
    url = f"https://{GITLAB_HOST}/api/v4/{endpoint}"
    cmd = ["curl", "-s", "--fail"]
    if token:
        cmd += ["-H", f"PRIVATE-TOKEN: {token}"]
    cmd.append(url)
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def fetch_page_bounded(endpoint: str) -> list | dict:
    """Fetch exactly one page (no auto-pagination): glab -> urllib -> curl."""
    token = _get_token()

    if shutil.which("glab"):
        try:
            return _fetch_page_glab(endpoint)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
            print(f"WARNING: glab API call failed ({e}), falling back to urllib", file=sys.stderr)

    try:
        return _fetch_page_urllib(endpoint, token)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"WARNING: urllib API call failed ({e}), falling back to curl", file=sys.stderr)

    try:
        return _fetch_page_curl(endpoint, token)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print(f"ERROR: All API methods failed. Last error: {e}", file=sys.stderr)
        sys.exit(1)


def fetch_merged_mrs(since: datetime, until: datetime, max_pages: int = 10) -> list:
    """Fetch merge requests merged within [since, until].

    Sorted/paginated by updated_at (NOT merged_at - GitLab's list endpoint
    can't sort by merged_at reliably across instances). updated_at >=
    merged_at always, so once a page's newest updated_at falls before
    `since` it is safe to stop paginating; the actual window filter below
    is always applied against merged_at, never updated_at. Fetches at most
    `max_pages` pages (one API call each) regardless of window size, since
    this is a weekly script expecting a handful of matching MRs.
    """
    project = urllib.parse.quote(PROJECT_PATH, safe="")
    matches = []
    page = 1
    while page <= max_pages:
        endpoint = (
            f"projects/{project}/merge_requests"
            f"?state=merged&order_by=updated_at&sort=desc&per_page=100&page={page}"
        )
        batch = fetch_page_bounded(endpoint)
        if not isinstance(batch, list) or not batch:
            break

        oldest_updated_at = None
        for mr in batch:
            merged_at_str = mr.get("merged_at")
            if not merged_at_str:
                continue
            try:
                merged_at = datetime.fromisoformat(merged_at_str.replace("Z", "+00:00"))
            except ValueError:
                continue
            if since <= merged_at <= until:
                mr["_merged_at_dt"] = merged_at
                matches.append(mr)

            updated_at_str = mr.get("updated_at")
            if updated_at_str:
                try:
                    updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                    if oldest_updated_at is None or updated_at < oldest_updated_at:
                        oldest_updated_at = updated_at
                except ValueError:
                    pass

        if oldest_updated_at is not None and oldest_updated_at < since:
            break
        page += 1

    return matches


def matches_topic(mr: dict) -> bool:
    labels = " ".join(mr.get("labels", []) or []).lower()
    title = (mr.get("title") or "").lower()
    haystack = f"{labels} {title}"
    return any(keyword in haystack for keyword in TOPIC_KEYWORDS)


# ---------------------------------------------------------------------------
# LLM paraphrasing
# ---------------------------------------------------------------------------

def draft_entry(client, mr: dict) -> str | None:
    """Ask the LLM to paraphrase one MR into a tone-compliant changelog entry."""
    merged_at: datetime = mr["_merged_at_dt"]
    mr_iid = mr.get("iid")
    mr_url = mr.get("web_url", "")
    mr_number_link = f"vtk/vtk!{mr_iid}" if mr_iid else ""

    user_prompt = f"""\
Merge request to paraphrase:

Title: {mr.get('title', '')}
Description:
{mr.get('description') or '(no description provided)'}

Labels: {', '.join(mr.get('labels', []) or [])}
Merged date: {merged_at.strftime('%B %d, %Y')}
MR link text: {mr_number_link}
MR URL: {mr_url}

Use "{mr_number_link}" and "{mr_url}" verbatim if you include a details link - do not
invent a different MR number or URL.
"""

    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1024,
        system=TONE_RULES,
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": user_prompt}],
    )

    text_parts = [block.text for block in response.content if block.type == "text"]
    entry = "".join(text_parts).strip()
    return entry or None


# ---------------------------------------------------------------------------
# news.md insertion
# ---------------------------------------------------------------------------

_DATE_LINE_RE = re.compile(r"^__([A-Z][a-z]+ \d+, \d{4})__$", re.MULTILINE)


def _parse_block_date(block_text: str) -> datetime | None:
    """Parse the '__Month DD, YYYY__' date line inside a heading block."""
    m = _DATE_LINE_RE.search(block_text)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%B %d, %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_blocks(text: str) -> list[dict]:
    """Split `text` into top-level '## ...' blocks, each with its start offset
    and date (parsed from its own '__Month DD, YYYY__' line, if present).
    """
    headings = list(_HEADING_RE.finditer(text))
    blocks = []
    for i, m in enumerate(headings):
        start = m.start()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        blocks.append({"start": start, "date": _parse_block_date(text[start:end])})
    return blocks


def find_insertion_offset(blocks: list[dict], entry_date: datetime, text_len: int) -> int:
    """Where `entry_date` belongs among `blocks`, keeping the file's overall
    descending-date order intact: immediately before the first block whose
    date is older than `entry_date` (or whose date can't be parsed - safer to
    stop there than to insert inside an unrecognized block). If every block
    is newer than or equal to `entry_date`, insert at end of file.
    """
    for block in blocks:
        if block["date"] is None or block["date"] < entry_date:
            return block["start"]
    return text_len


def insert_entries(news_path: Path, entries: list[tuple[datetime, str]], dry_run: bool) -> None:
    """Insert (date, entry_markdown) pairs into news.md in the correct
    chronological slot, rather than always dumping them below the newest
    heading - a heading's position doesn't guarantee it's newer than every
    entry being drafted (e.g. several daily release packages can land on the
    same day, or a merge can land the day *before* the latest release).
    """
    if not entries:
        print("No matching MRs found for this window - nothing to draft.", file=sys.stderr)
        return

    # Newest first, so entries sharing a target slot keep descending order.
    entries = sorted(entries, key=lambda e: e[0], reverse=True)

    if dry_run:
        print("\n\n".join(text for _, text in entries) + "\n")
        return

    text = news_path.read_text(encoding="utf-8")
    blocks = parse_blocks(text)

    groups: dict[int, list[str]] = {}
    for date, entry_text in entries:
        offset = find_insertion_offset(blocks, date, len(text))
        groups.setdefault(offset, []).append(entry_text)

    # Insert highest offset first so earlier offsets stay valid as we go.
    for offset in sorted(groups, reverse=True):
        chunk = "".join(t + "\n\n" for t in groups[offset])
        text = text[:offset] + chunk + text[offset:]

    news_path.write_text(text, encoding="utf-8")
    print(f"Inserted {len(entries)} drafted entries into {news_path.relative_to(REPO_ROOT)}",
          file=sys.stderr)


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Draft docs/news.md changelog entries from recently merged VTK MRs."
    )
    parser.add_argument("--dry-run", action="store_true",
                         help="Print drafted entries without modifying news.md")
    parser.add_argument("--since", type=lambda s: datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc),
                         default=None, metavar="YYYY-MM-DD",
                         help="Start of merge window (default: 7 days before --until)")
    parser.add_argument("--until", type=lambda s: datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc),
                         default=None, metavar="YYYY-MM-DD",
                         help="End of merge window (default: now)")
    args = parser.parse_args()

    if not NEWS_PATH.exists():
        print(f"ERROR: {NEWS_PATH} not found", file=sys.stderr)
        sys.exit(1)

    until = args.until or datetime.now(timezone.utc)
    since = args.since or (until - timedelta(days=7))

    print(f"Scanning merged MRs from {since.date()} to {until.date()} ...", file=sys.stderr)
    mrs = fetch_merged_mrs(since, until)
    print(f"  Found {len(mrs)} merged MR(s) in window", file=sys.stderr)

    topical = [mr for mr in mrs if matches_topic(mr)]
    print(f"  {len(topical)} match tracked topics ({', '.join(TOPIC_KEYWORDS)})", file=sys.stderr)

    if not topical:
        print("No topical MRs found - nothing to draft.", file=sys.stderr)
        return

    topical.sort(key=lambda mr: mr["_merged_at_dt"], reverse=True)

    try:
        import anthropic
    except ImportError:
        print("ERROR: the 'anthropic' package is required (pip install anthropic)", file=sys.stderr)
        sys.exit(1)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY is not set", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic()

    entries = []
    for mr in topical:
        print(f"  Drafting entry for !{mr.get('iid')}: {mr.get('title')}", file=sys.stderr)
        entry = draft_entry(client, mr)
        if entry:
            entries.append((mr["_merged_at_dt"], entry))
        else:
            print(f"  WARNING: empty draft for !{mr.get('iid')}, skipping", file=sys.stderr)

    insert_entries(NEWS_PATH, entries, args.dry_run)


if __name__ == "__main__":
    main()
