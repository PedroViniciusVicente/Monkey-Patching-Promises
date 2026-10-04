#!/usr/bin/env python3
"""
Generate an interactive SVG/HTML visualization from a newline-delimited JSON
async-hooks log.

Usage:
    python3 graph_and_label_v3.py test_async_await_fs-trace.jsonl test_async_await_fs.spec.js --output test_async_await_fs_graph_v3.html

The graph contains:
  * every object whose top-level testFile matches TEST_FILE or whose stack
    contains TEST_FILE;
  * every direct child whose triggerAsyncId points to one of those objects;
  * one horizontal lifetime bar per tracked async object;
  * trigger relationship connectors;
  * elapsed time on X, starting at 0 ms;
  * a 0-based tracked-object index on Y, with 0 at the bottom;
  * source-line badges (L5, L6, ...) above test-file objects when the matching
    stack frame contains a line number.

The generated HTML has no runtime dependency on Python, npm, D3, Plotly, etc.
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
        "test_file", help="Analyzed test filename, e.g. test_async_await_fs.spec.js"
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output HTML path (default: <log>_<test>_graph.html)",
    )
    return parser.parse_args()


def read_records(path: Path) -> Iterable[Tuple[int, Record]]:
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
    return any(
        isinstance(frame, dict)
        and isinstance(frame.get("file"), str)
        and needle in frame["file"].lower()
        for frame in stack
    )


def is_test_record(record: Record, test_file: str) -> bool:
    top_level = record.get("testFile")
    return (
        isinstance(top_level, str) and top_level.lower() == test_file.lower()
    ) or stack_contains_test_file(record, test_file)


def timestamp_ms(value: Any) -> float:
    if not isinstance(value, str):
        raise ValueError(f"Timestamp must be a string, got {value!r}")
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt.timestamp() * 1000.0


def normalize_record(
    record: Record, y_index: int, t0_ms: float, test_file: str
) -> Record:
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
    settled_ms = max(settled_ms, created_ms)

    matching_frames: List[Record] = []
    source_lines: List[int] = []
    stack = record.get("stack") or []
    if isinstance(stack, list):
        needle = test_file.lower()
        for frame in stack:
            if not isinstance(frame, dict):
                continue
            file_name = frame.get("file")
            if not isinstance(file_name, str) or needle not in file_name.lower():
                continue
            line = frame.get("line")
            column = frame.get("column")
            matching_frames.append(
                {
                    "functionName": frame.get("functionName"),
                    "file": file_name,
                    "line": line,
                    "column": column,
                }
            )
            if isinstance(line, int) and line not in source_lines:
                source_lines.append(line)

    matching_file = ""
    if matching_frames:
        matching_file = matching_frames[0].get("file") or ""
    elif isinstance(record.get("testFile"), str):
        matching_file = record["testFile"]

    return {
        "asyncId": async_id,
        "triggerAsyncId": trigger_id,
        "internalId": record.get("internalId"),
        "createdAt": record.get("createdAt"),
        "settledAt": record.get("settledAt"),
        "createdMs": round(created_ms, 6),
        "settledMs": round(settled_ms, 6),
        "durationMs": record.get("durationMs"),
        "testFile": record.get("testFile"),
        "matchingFrames": matching_frames,
        "sourceLines": source_lines,
        "matchFile": matching_file,
        "yIndex": y_index,
    }


def collect_records(log_path: Path, test_file: str) -> Tuple[List[Record], int]:
    """Use two passes so children can appear before their parents in the log."""
    target_by_id: Dict[int, Record] = {}
    total = 0

    for _, record in read_records(log_path):
        total += 1
        if not is_test_record(record, test_file):
            continue
        if "asyncId" not in record:
            continue
        try:
            async_id = int(record["asyncId"])
        except (TypeError, ValueError):
            continue
        target_by_id.setdefault(async_id, record)

    target_ids = set(target_by_id)
    if not target_ids:
        raise ValueError(
            f'No records matched test file "{test_file}". '
            "Check the filename or the stack/testFile fields."
        )

    children_by_id: Dict[int, Record] = {}
    for _, record in read_records(log_path):
        if "asyncId" not in record:
            continue
        try:
            async_id = int(record["asyncId"])
            trigger_id = int(record.get("triggerAsyncId"))
        except (TypeError, ValueError):
            continue
        if trigger_id in target_ids:
            children_by_id.setdefault(async_id, record)

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

    # Preserve the previous convention: Y=0..N-1 follows ascending real asyncId.
    tracked_ids = sorted(tracked_by_id)
    y_lookup = {async_id: index for index, async_id in enumerate(tracked_ids)}

    normalized: List[Record] = []
    for async_id in tracked_ids:
        record, is_target = tracked_by_id[async_id]
        item = normalize_record(record, y_lookup[async_id], earliest, test_file)
        item["isTarget"] = is_target
        normalized.append(item)

    return normalized, total


def js_json(value: Any) -> str:
    # Prevent JSON embedded in a <script> element from terminating the script.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(
        "<", "\\u003c"
    )


def build_html(records: List[Record], test_file: str, total_log_records: int) -> str:
    records_sorted = sorted(records, key=lambda r: r["asyncId"])
    targets = [r for r in records_sorted if r["isTarget"]]
    target_ids = {r["asyncId"] for r in targets}

    edges = [
        {"from": r["triggerAsyncId"], "to": r["asyncId"]}
        for r in records_sorted
        if r.get("triggerAsyncId") in target_ids
        and r.get("triggerAsyncId") != r["asyncId"]
    ]

    max_time = max((float(r["settledMs"]) for r in records_sorted), default=1.0)
    max_time = max(max_time, 1.0)

    data = {
        "testFile": test_file,
        "totalLogRecords": total_log_records,
        "targetCount": len(targets),
        "trackedCount": len(records_sorted),
        "maxTimeMs": max_time,
        "records": records_sorted,
        "edges": edges,
    }

    row_h = 42
    margin_left = 215
    margin_right = 50
    margin_top = 60
    margin_bottom = 72
    min_plot_width = 1100
    px_per_ms = max(1.5, min(15.0, 5000.0 / max_time))
    plot_width = max(min_plot_width, int(max_time * px_per_ms))
    plot_height = row_h * max(len(records_sorted), 1)
    width = margin_left + plot_width + margin_right
    height = margin_top + plot_height + margin_bottom

    config = {
        "width": width,
        "height": height,
        "marginLeft": margin_left,
        "marginRight": margin_right,
        "marginTop": margin_top,
        "marginBottom": margin_bottom,
        "plotWidth": plot_width,
        "plotHeight": plot_height,
        "rowH": row_h,
    }

    page_title = f"Async graph — {test_file}"
    title = html.escape(page_title, quote=True)
    data_json = js_json(data)
    config_json = js_json(config)

    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{
    --bg:#0f172a; --panel:#111827; --panel2:#1f2937; --text:#e5e7eb; --muted:#94a3b8;
    --grid:#334155; --axis:#cbd5e1; --target:#ef4444; --target-soft:rgba(239,68,68,.09);
    --child:#3b82f6; --child-soft:rgba(59,130,246,.045); --edge:#94a3b8; --source:#f59e0b;
  }}
  * {{ box-sizing:border-box; }}
  html,body {{ margin:0; min-height:100%; background:var(--bg); color:var(--text); font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }}
  header {{ padding:18px 22px 12px; position:sticky; top:0; z-index:10; background:rgba(15,23,42,.96); backdrop-filter:blur(8px); border-bottom:1px solid #1e293b; }}
  h1 {{ margin:0 0 6px; font-size:20px; }}
  .summary {{ color:var(--muted); font-size:13px; }}
  .toolbar {{ display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-top:12px; font-size:13px; }}
  button {{ border:1px solid #475569; background:var(--panel2); color:var(--text); border-radius:6px; padding:6px 10px; cursor:pointer; }}
  button:hover {{ background:#334155; }}
  input[type=range] {{ width:180px; }}
  main {{ padding:14px 18px 24px; }}
  .legend {{ display:flex; flex-wrap:wrap; gap:18px; margin-bottom:8px; color:var(--muted); font-size:13px; }}
  .swatch {{ display:inline-block; width:28px; height:5px; vertical-align:middle; margin-right:6px; border-radius:4px; }}
  .source-key {{ color:var(--source); font-weight:800; }}
  .canvas {{ overflow:auto; border:1px solid #1e293b; border-radius:8px; background:#020617; max-height:calc(100vh - 180px); }}
  svg {{ display:block; user-select:none; }}
  .grid-line {{ stroke:var(--grid); stroke-width:1; stroke-dasharray:3 4; opacity:.65; }}
  .axis-line {{ stroke:var(--axis); stroke-width:1.2; }}
  .axis-text {{ fill:#94a3b8; font-size:11px; }}
  .axis-title {{ fill:#cbd5e1; font-size:12px; font-weight:600; }}
  .row-label {{ fill:#cbd5e1; font-size:11px; dominant-baseline:middle; }}
  .life {{ stroke-width:5; stroke-linecap:round; cursor:pointer; }}
  .target-life {{ stroke:var(--target); }}
  .child-life {{ stroke:var(--child); }}
  .life.active {{ stroke-width:7; }}
  .edge {{ fill:none; stroke:var(--edge); stroke-width:1.5; opacity:.62; marker-end:url(#arrow); }}
  .edge.active {{ stroke:#f8fafc; opacity:1; stroke-width:2.6; }}
  .start-dot,.end-dot {{ r:3.4; cursor:pointer; }}
  .target-dot {{ fill:var(--target); }}
  .child-dot {{ fill:var(--child); }}
  .target-bg {{ fill:var(--target-soft); }}
  .child-bg {{ fill:var(--child-soft); }}
  .source-stem {{ stroke:var(--source); stroke-width:1.3; stroke-dasharray:2 3; opacity:.85; }}
  .source-label-bg {{ fill:#451a03; stroke:var(--source); stroke-width:1; rx:4; }}
  .source-label {{ fill:#fbbf24; font-size:10px; font-weight:800; dominant-baseline:middle; }}
  #tooltip {{ position:fixed; display:none; max-width:540px; padding:11px 13px; border:1px solid #475569; background:#020617; color:#e5e7eb; border-radius:8px; box-shadow:0 8px 30px rgba(0,0,0,.4); font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; z-index:20; pointer-events:none; white-space:pre-wrap; }}
  .tip-title {{ font-weight:700; color:#fff; margin-bottom:4px; }}
  .note {{ color:#64748b; font-size:12px; margin-top:8px; }}
  code {{ color:#cbd5e1; }}
</style>
</head>
<body>
<header>
  <h1>{title}</h1>
  <div class="summary">{total_log_records:,} log records → {len(targets):,} test-file objects → {len(records_sorted):,} tracked objects</div>
  <div class="toolbar">
    <button id="resetBtn">Reset view</button>
    <label>Zoom <input id="zoom" type="range" min="0.5" max="3" step="0.1" value="1"></label>
    <label><input id="onlyTargets" type="checkbox"> test-file objects only</label>
  </div>
</header>
<main>
  <div class="legend">
    <span><span class="swatch" style="background:var(--target)"></span>test-file object</span>
    <span><span class="swatch" style="background:var(--child)"></span>direct child</span>
    <span><span class="source-key">L#</span> matching source line in the analyzed test</span>
    <span>gray connectors = <code>triggerAsyncId</code> relationships</span>
  </div>
  <div class="canvas" id="canvas">
    <svg id="graph" xmlns="http://www.w3.org/2000/svg" width="{config['width']}" height="{config['height']}" viewBox="0 0 {config['width']} {config['height']}">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path>
        </marker>
      </defs>
    </svg>
  </div>
  <div class="note">Cartesian origin is the bottom-left corner. X=0 is the earliest tracked <code>createdAt</code>; Y=0 is the first tracked-object row and increases upward. Hover an object to highlight its trigger relationships.</div>
</main>
<div id="tooltip"></div>
<script>
const DATA = {data_json};
const CFG = {config_json};
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('graph');
const tip = document.getElementById('tooltip');
const zoom = document.getElementById('zoom');
const onlyTargets = document.getElementById('onlyTargets');
const resetBtn = document.getElementById('resetBtn');
const xOrigin = CFG.marginLeft;
const yBottom = CFG.marginTop + CFG.plotHeight;
const yLookup = new Map(DATA.records.map(r => [r.asyncId, r]));

function x(ms, width=CFG.plotWidth) {{
  return xOrigin + (ms / DATA.maxTimeMs) * width;
}}
function y(r) {{
  return yBottom - (r.yIndex + 0.5) * CFG.rowH;
}}
function elt(tag, attrs={{}}) {{
  const e = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attrs)) e.setAttribute(key, value);
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
function escHtml(value) {{
  return String(value ?? '').replace(/[&<>"']/g, ch => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}})[ch]);
}}
function positionTip(event) {{
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  tip.style.left = `${{Math.min(event.clientX + pad, Math.max(8, window.innerWidth - rect.width - 8))}}px`;
  tip.style.top = `${{Math.min(event.clientY + pad, Math.max(8, window.innerHeight - rect.height - 8))}}px`;
}}
function showTip(event, r) {{
  const frames = (r.matchingFrames || [])
    .map(f => `  ${{f.functionName || '<anonymous>'}} @ ${{f.file || '?'}}:${{f.line ?? '?'}}:${{f.column ?? '?'}}`)
    .join('\\n');
  const sourceLines = (r.sourceLines || []).map(n => `L${{n}}`).join(', ');
  tip.innerHTML = `<div class="tip-title">asyncId ${{r.asyncId}} — ${{r.isTarget ? 'test-file object' : 'direct trigger child'}}</div>` +
    `triggerAsyncId: ${{r.triggerAsyncId ?? 'null'}}\\n` +
    `createdAt: ${{escHtml(r.createdAt ?? 'null')}}\\n` +
    `settledAt: ${{escHtml(r.settledAt ?? 'null')}}\\n` +
    `elapsed: ${{fmtMs(r.createdMs)}} → ${{fmtMs(r.settledMs)}}\\n` +
    `durationMs: ${{r.durationMs ?? 'null'}}\\n` +
    (r.internalId ? `internalId: ${{escHtml(r.internalId)}}\\n` : '') +
    (r.testFile ? `testFile: ${{escHtml(r.testFile)}}\\n` : '') +
    (r.matchFile ? `matching file: ${{escHtml(r.matchFile)}}\\n` : '') +
    (sourceLines ? `source line(s): ${{escHtml(sourceLines)}}\\n` : '') +
    (frames ? `\\nmatching stack frame(s):\\n${{escHtml(frames)}}` : '');
  tip.style.display = 'block';
  positionTip(event);
}}
function hideTip() {{ tip.style.display = 'none'; }}
function activateEdges(asyncId) {{
  document.querySelectorAll('.edge').forEach(edge => {{
    edge.classList.toggle('active', Number(edge.dataset.from) === asyncId || Number(edge.dataset.to) === asyncId);
  }});
  document.querySelectorAll('.life').forEach(life => {{
    life.classList.toggle('active', Number(life.dataset.asyncId) === asyncId);
  }});
}}
function clearHighlights() {{
  document.querySelectorAll('.edge.active').forEach(edge => edge.classList.remove('active'));
  document.querySelectorAll('.life.active').forEach(life => life.classList.remove('active'));
}}
function addSourceBadge(g, r, xPos, yy) {{
  if (!r.isTarget || !r.sourceLines || !r.sourceLines.length) return;
  const label = r.sourceLines.map(n => `L${{n}}`).join(',');
  const badgeWidth = Math.max(28, 10 + label.length * 6.2);
  const badgeY = yy - 30;
  g.appendChild(elt('line', {{x1:xPos, y1:badgeY+17, x2:xPos, y2:yy-7, class:'source-stem'}}));
  g.appendChild(elt('rect', {{x:xPos-badgeWidth/2, y:badgeY, width:badgeWidth, height:17, class:'source-label-bg'}}));
  addText(g, xPos, badgeY+8.5, label, 'source-label', 'middle');
}}

function render() {{
  while (svg.lastChild && svg.lastChild.tagName !== 'defs') svg.removeChild(svg.lastChild);

  const zoomFactor = Number(zoom.value);
  const showOnlyTarget = onlyTargets.checked;
  const visible = DATA.records.filter(r => !showOnlyTarget || r.isTarget);
  const visibleIds = new Set(visible.map(r => r.asyncId));
  const visibleEdges = DATA.edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
  const plotWidth = Math.max(CFG.plotWidth * zoomFactor, 1100);
  const contentWidth = xOrigin + plotWidth + CFG.marginRight;
  const axisY = yBottom;

  svg.setAttribute('width', contentWidth);
  svg.setAttribute('height', CFG.height);
  svg.setAttribute('viewBox', `0 0 ${{contentWidth}} ${{CFG.height}}`);

  const g = elt('g');
  svg.appendChild(g);

  // Alternating object rows; row 0 is physically at the bottom.
  for (const r of visible) {{
    const yy = y(r);
    g.appendChild(elt('rect', {{
      x:0, y:yy-CFG.rowH/2, width:contentWidth, height:CFG.rowH,
      class:r.isTarget ? 'target-bg' : 'child-bg'
    }}));
    addText(g, xOrigin - 12, yy + 4, `${{r.yIndex}} · asyncId ${{r.asyncId}}`, 'row-label', 'end');
  }}

  // Time grid and labels along the bottom axis.
  const tickCount = 10;
  for (let i=0; i<=tickCount; i++) {{
    const value = DATA.maxTimeMs * i / tickCount;
    const xx = x(value, plotWidth);
    g.appendChild(elt('line', {{x1:xx, y1:CFG.marginTop, x2:xx, y2:axisY, class:'grid-line'}}));
    addText(g, xx, axisY + 22, fmtMs(value), 'axis-text', 'middle');
  }}

  addText(g, xOrigin + plotWidth/2, CFG.height - 17, 'Elapsed time from earliest tracked createdAt', 'axis-title', 'middle');
  const yTitle = addText(g, 18, CFG.marginTop + CFG.plotHeight/2, 'Tracked object index (0 at bottom)', 'axis-title', 'middle');
  yTitle.setAttribute('transform', `rotate(-90 18 ${{CFG.marginTop + CFG.plotHeight/2}})`);

  // Trigger edges first, so object lifetimes remain prominent.
  for (const edge of visibleEdges) {{
    const parent = yLookup.get(edge.from);
    const child = yLookup.get(edge.to);
    if (!parent || !child) continue;
    const x1 = x(parent.settledMs, plotWidth);
    const y1 = y(parent);
    const x2 = x(child.createdMs, plotWidth);
    const y2 = y(child);
    const mid = (x1 + x2) / 2;
    const path = elt('path', {{
      d:`M ${{x1}} ${{y1}} C ${{mid}} ${{y1}}, ${{mid}} ${{y2}}, ${{x2}} ${{y2}}`,
      class:'edge', 'data-from':edge.from, 'data-to':edge.to
    }});
    path.addEventListener('mouseenter', e => {{
      path.classList.add('active');
      tip.textContent = `triggerAsyncId relationship\\n${{edge.from}} → ${{edge.to}}\\nparent settledAt: ${{parent.settledAt}}\\nchild createdAt: ${{child.createdAt}}`;
      tip.style.display='block';
      positionTip(e);
    }});
    path.addEventListener('mousemove', positionTip);
    path.addEventListener('mouseleave', () => {{ path.classList.remove('active'); hideTip(); }});
    g.appendChild(path);
  }}

  // Object lifetimes and source-line annotations.
  for (const r of visible) {{
    const yy = y(r);
    const x1 = x(r.createdMs, plotWidth);
    const x2 = x(r.settledMs, plotWidth);
    const endX = Math.max(x2, x1 + 2);

    const life = elt('line', {{
      x1, y1:yy, x2:endX, y2:yy,
      class:`life ${{r.isTarget ? 'target-life' : 'child-life'}}`,
      'data-async-id':r.asyncId
    }});
    life.addEventListener('mouseenter', e => {{ activateEdges(r.asyncId); showTip(e, r); }});
    life.addEventListener('mousemove', positionTip);
    life.addEventListener('mouseleave', () => {{ clearHighlights(); hideTip(); }});
    g.appendChild(life);

    const start = elt('circle', {{cx:x1, cy:yy, class:`start-dot ${{r.isTarget ? 'target-dot' : 'child-dot'}}`}});
    const end = elt('circle', {{cx:endX, cy:yy, class:`end-dot ${{r.isTarget ? 'target-dot' : 'child-dot'}}`}});
    for (const dot of [start, end]) {{
      dot.addEventListener('mouseenter', e => {{ activateEdges(r.asyncId); showTip(e, r); }});
      dot.addEventListener('mousemove', positionTip);
      dot.addEventListener('mouseleave', () => {{ clearHighlights(); hideTip(); }});
      g.appendChild(dot);
    }}

    addSourceBadge(g, r, x1, yy);
  }}

  // Bottom-left Cartesian axes.
  g.appendChild(elt('line', {{x1:xOrigin, y1:CFG.marginTop, x2:xOrigin, y2:axisY, class:'axis-line'}}));
  g.appendChild(elt('line', {{x1:xOrigin, y1:axisY, x2:xOrigin+plotWidth, y2:axisY, class:'axis-line'}}));
}}

zoom.addEventListener('input', render);
onlyTargets.addEventListener('change', render);
resetBtn.addEventListener('click', () => {{
  zoom.value='1';
  onlyTargets.checked=false;
  render();
  document.getElementById('canvas').scrollLeft=0;
  document.getElementById('canvas').scrollTop=0;
}});
render();
</script>
</body>
</html>
'''


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
        records, total = collect_records(log_path, args.test_file)
        output.write_text(
            build_html(records, args.test_file, total), encoding="utf-8"
        )
    except (OSError, ValueError, KeyError) as exc:
        raise SystemExit(f"Error: {exc}") from exc

    target_count = sum(1 for r in records if r["isTarget"])
    source_badges = sum(bool(r.get("sourceLines")) for r in records if r["isTarget"])
    print(f"Input records:     {total:,}")
    print(f"Test-file objects: {target_count:,}")
    print(f"Tracked objects:   {len(records):,}")
    print(f"Source badges:     {source_badges:,}")
    print(f"Output:            {output}")


if __name__ == "__main__":
    main()
