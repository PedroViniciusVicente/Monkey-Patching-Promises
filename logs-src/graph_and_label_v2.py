#!/usr/bin/env python3
"""
Visualize asyncId/triggerAsyncId relationships from a newline-delimited JSON log.

Usage:
    python3 graph_and_label_v2.py test_async_await_fs-trace.jsonl test_async_await_fs.spec.js --output test_async_await_fs_graph.html

Example:
    python async_log_graph.py Texto_colado.txt test_async_await_fs.spec.js \
        --output test_async_await_fs_graph.html

The tool:
  1. Finds every JSON record whose top-level `testFile` matches TEST_FILE OR
     whose stack contains a `file` containing TEST_FILE.
  2. Finds every record whose `triggerAsyncId` is one of those records' asyncIds.
  3. De-duplicates tracked records by asyncId.
  4. Uses the earliest tracked `createdAt` as time 0 ms.
  5. Assigns each tracked asyncId a 0-based Y position (sorted by asyncId), while
     keeping the real asyncId visible in labels/tooltips.
  6. Draws each object's lifetime [createdAt, settledAt] and trigger edges.
  7. Writes a standalone HTML/SVG visualization (no npm/Python dependencies).
"""

from __future__ import annotations

import argparse
import html
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


Record = Dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate an interactive asyncId graph from a NDJSON log."
    )
    parser.add_argument("log_file", help="Path to the newline-delimited JSON log")
    parser.add_argument(
        "test_file",
        help="Analyzed test filename, e.g. test_async_await_fs.spec.js",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output HTML path (default: <log>_<test>_graph.html)",
    )
    return parser.parse_args()


def read_records(path: Path) -> Iterable[Tuple[int, Record]]:
    """Stream valid NDJSON records, returning (1-based line number, object)."""
    with path.open("r", encoding="utf-8") as fh:
        for line_number, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Invalid JSON at line {line_number}: {exc.msg}"
                ) from exc
            if not isinstance(record, dict):
                raise ValueError(
                    f"Expected a JSON object at line {line_number}, "
                    f"got {type(record).__name__}."
                )
            yield line_number, record


def stack_contains_test_file(record: Record, test_file: str) -> bool:
    needle = test_file.lower()
    stack = record.get("stack") or []
    if not isinstance(stack, list):
        return False
    for frame in stack:
        if not isinstance(frame, dict):
            continue
        file_name = frame.get("file")
        if isinstance(file_name, str) and needle in file_name.lower():
            return True
    return False


def is_test_record(record: Record, test_file: str) -> bool:
    top_level = record.get("testFile")
    return (
        isinstance(top_level, str) and top_level.lower() == test_file.lower()
    ) or stack_contains_test_file(record, test_file)


def timestamp_ms(value: Any) -> float:
    if not isinstance(value, str):
        raise ValueError(f"Timestamp must be a string, got {value!r}")
    # datetime.fromisoformat accepts the Z suffix after converting it to +00:00.
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.timestamp() * 1000.0


def first_file_in_stack(record: Record, test_file: str) -> str:
    stack = record.get("stack") or []
    if isinstance(stack, list):
        needle = test_file.lower()
        for frame in stack:
            if isinstance(frame, dict) and isinstance(frame.get("file"), str):
                if needle in frame["file"].lower():
                    return frame["file"]
    top_level = record.get("testFile")
    return top_level if isinstance(top_level, str) else ""


def normalize_record(record: Record, y_index: int, t0_ms: float, test_file: str) -> Record:
    async_id = int(record["asyncId"])
    trigger = record.get("triggerAsyncId")
    try:
        trigger_id = int(trigger) if trigger is not None else None
    except (TypeError, ValueError):
        trigger_id = None

    created_ms = timestamp_ms(record["createdAt"]) - t0_ms
    settled_value = record.get("settledAt")
    settled_ms = (
        timestamp_ms(settled_value) - t0_ms
        if settled_value is not None
        else created_ms
    )
    if settled_ms < created_ms:
        # Protect the visualization from a malformed/reordered timestamp.
        settled_ms = created_ms

    stack = record.get("stack") or []
    matching_frames = []
    if isinstance(stack, list):
        needle = test_file.lower()
        for frame in stack:
            if not isinstance(frame, dict):
                continue
            file_name = frame.get("file")
            if isinstance(file_name, str) and needle in file_name.lower():
                matching_frames.append(
                    {
                        "functionName": frame.get("functionName"),
                        "file": frame.get("file"),
                        "line": frame.get("line"),
                        "column": frame.get("column"),
                    }
                )

    return {
        "asyncId": async_id,
        "triggerAsyncId": trigger_id,
        "internalId": record.get("internalId"),
        "origin": record.get("origin"),
        "combinatorMethod": record.get("combinatorMethod"),
        "status": record.get("status"),
        "createdAt": record.get("createdAt"),
        "settledAt": record.get("settledAt"),
        "createdMs": round(created_ms, 6),
        "settledMs": round(settled_ms, 6),
        "durationMs": record.get("durationMs"),
        "continuationRuns": record.get("continuationRuns"),
        "testFile": record.get("testFile"),
        "matchingFrames": matching_frames,
        "matchFile": first_file_in_stack(record, test_file),
        "yIndex": y_index,
    }


def collect_records(log_path: Path, test_file: str) -> Tuple[List[Record], List[Record], int]:
    """Two passes so children can occur before their parent in the log."""
    target_by_id: Dict[int, Record] = {}
    total = 0

    # Pass 1: identify target objects.
    for line_number, record in read_records(log_path):
        total += 1
        if not is_test_record(record, test_file):
            continue
        if "asyncId" not in record:
            continue
        try:
            async_id = int(record["asyncId"])
        except (TypeError, ValueError):
            continue
        # Keep the first complete representation of an asyncId.
        target_by_id.setdefault(async_id, record)

    target_ids = set(target_by_id)
    if not target_ids:
        raise ValueError(
            f'No records matched test file "{test_file}". '
            "Check the filename or the stack/testFile fields."
        )

    # Pass 2: identify direct children of the target objects.
    children_by_id: Dict[int, Record] = {}
    for _, record in read_records(log_path):
        trigger = record.get("triggerAsyncId")
        if trigger is None or "asyncId" not in record:
            continue
        try:
            trigger_id = int(trigger)
            async_id = int(record["asyncId"])
        except (TypeError, ValueError):
            continue
        if trigger_id in target_ids:
            children_by_id.setdefault(async_id, record)

    # Tracked set = targets + direct children, de-duplicated by asyncId.
    tracked_by_id: Dict[int, Tuple[Record, bool]] = {}
    for async_id, record in target_by_id.items():
        tracked_by_id[async_id] = (record, True)
    for async_id, record in children_by_id.items():
        tracked_by_id.setdefault(async_id, (record, False))

    earliest = math.inf
    for record, _ in tracked_by_id.values():
        try:
            earliest = min(earliest, timestamp_ms(record["createdAt"]))
        except (KeyError, TypeError, ValueError):
            pass
    if not math.isfinite(earliest):
        raise ValueError("Tracked records do not contain usable createdAt timestamps.")

    normalized: List[Record] = []
    target_ids_sorted = sorted(target_ids)
    tracked_ids_sorted = sorted(tracked_by_id)
    y_lookup = {async_id: idx for idx, async_id in enumerate(tracked_ids_sorted)}

    for async_id in tracked_ids_sorted:
        record, is_target = tracked_by_id[async_id]
        item = normalize_record(record, y_lookup[async_id], earliest, test_file)
        item["isTarget"] = is_target
        normalized.append(item)

    return normalized, normalized, total


def js_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_html(records: List[Record], test_file: str, total_log_records: int) -> str:
    records_sorted = sorted(records, key=lambda r: r["asyncId"])
    targets = [r for r in records_sorted if r["isTarget"]]
    target_ids = {r["asyncId"] for r in targets}
    by_id = {r["asyncId"]: r for r in records_sorted}

    edges = []
    for child in records_sorted:
        parent_id = child.get("triggerAsyncId")
        if parent_id in target_ids and parent_id != child["asyncId"]:
            edges.append(
                {
                    "from": parent_id,
                    "to": child["asyncId"],
                }
            )

    max_time = max((float(r["settledMs"]) for r in records_sorted), default=1.0)
    if max_time <= 0:
        max_time = 1.0

    data = {
        "testFile": test_file,
        "totalLogRecords": total_log_records,
        "targetCount": len(targets),
        "trackedCount": len(records_sorted),
        "maxTimeMs": max_time,
        "records": records_sorted,
        "edges": edges,
    }

    # Fixed layout chosen for readability; the browser can scroll horizontally.
    row_h = 36
    margin_left = 200
    margin_right = 40
    margin_top = 70
    margin_bottom = 70
    min_plot_width = 1100
    px_per_ms = max(1.5, min(15.0, 5000.0 / max_time))
    plot_width = max(min_plot_width, int(max_time * px_per_ms))
    width = margin_left + plot_width + margin_right
    height = margin_top + row_h * max(len(records_sorted), 1) + margin_bottom

    # Keep layout values in the page so SVG and JS use the same scale.
    config = {
        "width": width,
        "height": height,
        "marginLeft": margin_left,
        "marginRight": margin_right,
        "marginTop": margin_top,
        "marginBottom": margin_bottom,
        "plotWidth": plot_width,
        "rowH": row_h,
    }

    title = f"Async graph — {test_file}"
    initial_zoom = 1.0

    return f"""<!doctype html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
<title>{html.escape(title)}</title>
<style>
  :root {{
    --bg: #0f172a;
    --panel: #111827;
    --panel2: #1f2937;
    --text: #e5e7eb;
    --muted: #94a3b8;
    --grid: #334155;
    --target: #ef4444;
    --child: #3b82f6;
    --edge: #94a3b8;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text); font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }}
  header {{ padding:18px 22px 10px; position:sticky; top:0; z-index:10; background:rgba(15,23,42,.96); backdrop-filter:blur(8px); border-bottom:1px solid #1e293b; }}
  h1 {{ margin:0 0 6px; font-size:20px; }}
  .summary {{ color:var(--muted); font-size:13px; }}
  .toolbar {{ display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:12px; font-size:13px; }}
  button {{ border:1px solid #475569; background:var(--panel2); color:var(--text); border-radius:6px; padding:6px 10px; cursor:pointer; }}
  button:hover {{ background:#334155; }}
  input[type=range] {{ width:180px; }}
  main {{ padding:14px 18px 24px; }}
  .legend {{ display:flex; gap:18px; margin-bottom:8px; color:var(--muted); font-size:13px; }}
  .swatch {{ display:inline-block; width:28px; height:4px; vertical-align:middle; margin-right:6px; border-radius:4px; }}
  .canvas {{ overflow:auto; border:1px solid #1e293b; border-radius:8px; background:#020617; max-height:calc(100vh - 180px); }}
  svg {{ display:block; min-width:100%; user-select:none; }}
  .grid-line {{ stroke:var(--grid); stroke-width:1; stroke-dasharray:3 4; opacity:.7; }}
  .axis-text {{ fill:#94a3b8; font-size:11px; }}
  .axis-title {{ fill:#cbd5e1; font-size:12px; font-weight:600; }}
  .row-label {{ fill:#cbd5e1; font-size:11px; text-anchor:end; dominant-baseline:middle; }}
  .life {{ stroke-width:4; stroke-linecap:round; cursor:pointer; }}
  .target-life {{ stroke:var(--target); }}
  .child-life {{ stroke:var(--child); }}
  .edge {{ fill:none; stroke:var(--edge); stroke-width:1.4; opacity:.65; marker-end:url(#arrow); }}
  .start-dot, .end-dot {{ r:3.3; cursor:pointer; }}
  .target-dot {{ fill:var(--target); }}
  .child-dot {{ fill:var(--child); }}
  .target-bg {{ fill:rgba(239,68,68,.07); }}
  .child-bg {{ fill:rgba(59,130,246,.04); }}
  .hover-line {{ opacity:0; }}
  .hover-line.active {{ opacity:1; stroke:#f8fafc; stroke-width:1; stroke-dasharray:3 4; }}
  #tooltip {{ position:fixed; display:none; max-width:440px; padding:10px 12px; border:1px solid #475569; background:#020617; color:#e5e7eb; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,.4); font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; z-index:20; pointer-events:none; white-space:pre-wrap; }}
  .tip-title {{ font-weight:700; color:#fff; margin-bottom:4px; }}
  .note {{ color:#64748b; font-size:12px; margin-top:8px; }}
</style>
</head>
<body>
<header>
  <h1>{html.escape(title)}</h1>
  <div class=\"summary\">{total_log_records:,} log records → {len(targets):,} test-file records → {len(records_sorted):,} tracked objects</div>
  <div class=\"toolbar\">
    <button id=\"resetBtn\">Reset view</button>
    <label>Zoom <input id=\"zoom\" type=\"range\" min=\"0.5\" max=\"3\" step=\"0.1\" value=\"{initial_zoom}\"></label>
    <label><input id=\"onlyTargets\" type=\"checkbox\"> show test-file objects only</label>
  </div>
</header>
<main>
  <div class=\"legend\">
    <span><span class=\"swatch\" style=\"background:var(--target)\"></span>record whose stack/testFile identifies the analyzed test</span>
    <span><span class=\"swatch\" style=\"background:var(--child)\"></span>direct child (`triggerAsyncId` → target `asyncId`)</span>
    <span>gray connectors = trigger relationships</span>
  </div>
  <div class=\"canvas\" id=\"canvas\">
    <svg id=\"graph\" xmlns=\"http://www.w3.org/2000/svg\" width=\"{config['width']}\" height=\"{config['height']}\" viewBox=\"0 0 {config['width']} {config['height']}\">
      <defs>
        <marker id=\"arrow\" viewBox=\"0 0 10 10\" refX=\"8\" refY=\"5\" markerWidth=\"6\" markerHeight=\"6\" orient=\"auto-start-reverse\">
          <path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"#94a3b8\"></path>
        </marker>
      </defs>
    </svg>
  </div>
  <div class=\"note\">X = elapsed time from the earliest tracked <code>createdAt</code>. Y = 0-based tracked-object index; each row label also shows the real <code>asyncId</code>.</div>
</main>
<div id=\"tooltip\"></div>
<script>
const DATA = {js_json(data)};
const CFG = {js_json(config)};
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('graph');
const tip = document.getElementById('tooltip');
const zoom = document.getElementById('zoom');
const onlyTargets = document.getElementById('onlyTargets');
const resetBtn = document.getElementById('resetBtn');
const xOrigin = CFG.marginLeft;
const yOrigin = CFG.marginTop;
const yLookup = new Map(DATA.records.map(r => [r.asyncId, r]));

function clamp(v, lo, hi) {{ return Math.max(lo, Math.min(hi, v)); }}
function x(ms) {{
  return xOrigin + (ms / DATA.maxTimeMs) * CFG.plotWidth;
}}
function y(r) {{ return yOrigin + r.yIndex * CFG.rowH + CFG.rowH / 2; }}
function elt(tag, attrs={{}}) {{
  const e = document.createElementNS(NS, tag);
  for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}}
function addText(parent, xPos, yPos, text, cls, anchor='start') {{
  const e = elt('text', {{x:xPos, y:yPos, class:cls}});
  e.setAttribute('text-anchor', anchor);
  e.textContent = text;
  parent.appendChild(e);
  return e;
}}
function fmtMs(v) {{
  if (v < 1) return v.toFixed(3) + ' ms';
  if (v < 100) return v.toFixed(2) + ' ms';
  if (v < 1000) return v.toFixed(1) + ' ms';
  return (v/1000).toFixed(3) + ' s';
}}
function showTip(event, r) {{
  const frames = (r.matchingFrames || []).map(f => `  ${{f.functionName || '<anonymous>'}} @ ${{f.file || '?'}}:${{f.line ?? '?'}}:${{f.column ?? '?'}}`).join('\\n');
  tip.innerHTML = `<div class=\"tip-title\">asyncId ${{r.asyncId}} (${{r.isTarget ? 'test-file' : 'trigger child'}})</div>` +
    `triggerAsyncId: ${{r.triggerAsyncId ?? 'null'}}\\n` +
    `lifetime: ${{fmtMs(r.createdMs)}} → ${{fmtMs(r.settledMs)}}\\n` +
    `durationMs: ${{r.durationMs ?? 'null'}}\\n` +
    `origin: ${{r.origin ?? 'null'}}\\n` +
    `combinatorMethod: ${{r.combinatorMethod ?? 'null'}}\\n` +
    `status: ${{r.status ?? 'null'}}\\n` +
    `continuationRuns: ${{r.continuationRuns ?? 'null'}}\\n` +
    (r.internalId ? `internalId: ${{r.internalId}}\\n` : '') +
    (r.testFile ? `testFile: ${{r.testFile}}\\n` : '') +
    (r.matchFile ? `matching file: ${{r.matchFile}}\\n` : '') +
    (frames ? `\\nmatching stack frame(s):\\n${{frames}}` : '');
  tip.style.display = 'block';
  tip.style.left = `${{Math.min(event.clientX + 14, window.innerWidth - 470)}}px`;
  tip.style.top = `${{Math.min(event.clientY + 14, window.innerHeight - 260)}}px`;
}}
function hideTip() {{ tip.style.display = 'none'; }}

function render() {{
  while (svg.lastChild && svg.lastChild.tagName !== 'defs') svg.removeChild(svg.lastChild);

  const zoomFactor = Number(zoom.value);
  const showOnlyTarget = onlyTargets.checked;
  const visible = DATA.records.filter(r => !showOnlyTarget || r.isTarget);
  const visibleIds = new Set(visible.map(r => r.asyncId));
  const visibleEdges = DATA.edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
  const contentWidth = xOrigin + Math.max(CFG.plotWidth * zoomFactor, 1100) + CFG.marginRight;
  svg.setAttribute('width', contentWidth);
  svg.setAttribute('viewBox', `0 0 ${{contentWidth}} ${{CFG.height}}`);

  const g = elt('g');
  svg.appendChild(g);

  // Background rows and Y labels.
  for (const r of visible) {{
    const yy = y(r);
    const bg = elt('rect', {{x:0, y:yy-CFG.rowH/2, width:contentWidth, height:CFG.rowH, class:r.isTarget ? 'target-bg' : 'child-bg'}});
    g.appendChild(bg);
    addText(g, xOrigin - 12, yy + 4, `${{r.yIndex}} · ${{r.asyncId}}`, 'row-label', 'end');
  }}

  // X grid.
  const tickCount = 10;
  for (let i=0; i<=tickCount; i++) {{
    const val = DATA.maxTimeMs * i / tickCount;
    const xx = xOrigin + (val / DATA.maxTimeMs) * (Math.max(CFG.plotWidth * zoomFactor, 1100));
    g.appendChild(elt('line', {{x1:xx, y1:yOrigin-25, x2:xx, y2:yOrigin + visible.length*CFG.rowH, class:'grid-line'}}));
    addText(g, xx, yOrigin - 32, fmtMs(val), 'axis-text', 'middle');
  }}
  addText(g, xOrigin + Math.max(CFG.plotWidth * zoomFactor, 1100)/2, 24, 'Elapsed time from earliest tracked createdAt', 'axis-title', 'middle');
  addText(g, xOrigin - 14, 24, 'Y = 0-based tracked object index', 'axis-title', 'end');

  // Edges first, so object lifetime lines are visually on top.
  for (const edge of visibleEdges) {{
    const parent = yLookup.get(edge.from);
    const child = yLookup.get(edge.to);
    if (!parent || !child) continue;
    const x1 = x(parent.settledMs);
    const y1 = y(parent);
    const x2 = x(child.createdMs);
    const y2 = y(child);
    const mid = (x1 + x2) / 2;
    const p = elt('path', {{d:`M ${{x1}} ${{y1}} C ${{mid}} ${{y1}}, ${{mid}} ${{y2}}, ${{x2}} ${{y2}}`, class:'edge'}});
    p.addEventListener('mouseenter', e => {{
      tip.textContent = `triggerAsyncId relationship\\n${{edge.from}} → ${{edge.to}}\\nparent settles at ${{fmtMs(parent.settledMs)}}\\nchild created at ${{fmtMs(child.createdMs)}}`;
      tip.style.display='block'; tip.style.left=`${{e.clientX+14}}px`; tip.style.top=`${{e.clientY+14}}px`;
    }});
    p.addEventListener('mouseleave', hideTip);
    g.appendChild(p);
  }}

  // Object lifetimes.
  for (const r of visible) {{
    const yy = y(r);
    const x1 = x(r.createdMs);
    const x2 = x(r.settledMs);
    const life = elt('line', {{x1, y1:yy, x2:Math.max(x2, x1+2), y2:yy, class:`life ${{r.isTarget ? 'target-life' : 'child-life'}}`}});
    life.addEventListener('mouseenter', e => showTip(e, r));
    life.addEventListener('mousemove', e => {{ if (tip.style.display === 'block') {{ tip.style.left=`${{Math.min(e.clientX+14, window.innerWidth-470)}}px`; tip.style.top=`${{Math.min(e.clientY+14, window.innerHeight-260)}}px`; }} }});
    life.addEventListener('mouseleave', hideTip);
    g.appendChild(life);

    const c1 = elt('circle', {{cx:x1, cy:yy, class:`start-dot ${{r.isTarget ? 'target-dot' : 'child-dot'}}`}});
    const c2 = elt('circle', {{cx:Math.max(x2, x1+2), cy:yy, class:`end-dot ${{r.isTarget ? 'target-dot' : 'child-dot'}}`}});
    for (const c of [c1,c2]) {{
      c.addEventListener('mouseenter', e => showTip(e, r));
      c.addEventListener('mouseleave', hideTip);
      g.appendChild(c);
    }}
  }}

  // Axes.
  g.appendChild(elt('line', {{x1:xOrigin, y1:yOrigin-25, x2:xOrigin, y2:yOrigin + Math.max(visible.length,1)*CFG.rowH, stroke:'#cbd5e1', 'stroke-width':1.2}}));
  g.appendChild(elt('line', {{x1:xOrigin, y1:yOrigin-25, x2:xOrigin + Math.max(CFG.plotWidth*zoomFactor,1100), y2:yOrigin-25, stroke:'#cbd5e1', 'stroke-width':1.2}}));
}}

zoom.addEventListener('input', render);
onlyTargets.addEventListener('change', render);
resetBtn.addEventListener('click', () => {{ zoom.value='1'; onlyTargets.checked=false; render(); document.getElementById('canvas').scrollLeft=0; }});
render();
</script>
</body>
</html>
"""


def main() -> None:
    args = parse_args()
    log_path = Path(args.log_file).expanduser().resolve()
    if not log_path.exists():
        raise SystemExit(f"Log file does not exist: {log_path}")

    output = (
        Path(args.output).expanduser().resolve()
        if args.output
        else log_path.with_name(
            f"{log_path.stem}_{Path(args.test_file).name}_graph.html"
        ).resolve()
    )

    try:
        records, _, total = collect_records(log_path, args.test_file)
        html_text = build_html(records, args.test_file, total)
        output.write_text(html_text, encoding="utf-8")
    except (OSError, ValueError, KeyError) as exc:
        raise SystemExit(f"Error: {exc}") from exc

    target_count = sum(1 for r in records if r["isTarget"])
    print(f"Input records:    {total:,}")
    print(f"Test-file records:{target_count:>7,}")
    print(f"Tracked objects:  {len(records):>7,}")
    print(f"Output:            {output}")


if __name__ == "__main__":
    main()
