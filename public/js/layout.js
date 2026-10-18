// Geometry for the goal grid.
//
// Every node owns a square "region" in world space. The root's region is the
// unit square centred on (0,0). A child's region is the 1/3-size square in the
// direction of its slot, so the whole chart nests forever at 3x per level.
//
//  nested view  – the region is split into 9 blocks: the centre block holds the
//                 node and its 8 children (the classic mandala chart), each outer
//                 block is that child's own region, drawn the same way.
//  fractal view – the region is split into 9 cells: the centre cell is the node,
//                 each outer cell is that child's region, which subdivides again
//                 once it is big enough on screen.

// Grid positions (0-8, row-major) used by child slots 0-7. Position 4 is the centre.
export const SLOT_POS = [0, 1, 2, 3, 5, 6, 7, 8];

export function dirOf(slot) {
  const p = SLOT_POS[slot];
  return [(p % 3) - 1, Math.floor(p / 3) - 1];
}

export function pathTo(board, id) {
  const path = [];
  let cur = id;
  while (cur && board.nodes[cur]) {
    path.push(cur);
    cur = board.nodes[cur].parent;
  }
  return path.reverse();
}

export function regionOf(board, id) {
  const path = pathTo(board, id);
  let x = 0, y = 0, s = 1;
  for (let k = 1; k < path.length; k++) {
    const parent = board.nodes[path[k - 1]];
    const [dx, dy] = dirOf(parent.children.indexOf(path[k]));
    x += (dx * s) / 3;
    y += (dy * s) / 3;
    s /= 3;
  }
  return { x, y, s };
}

// The square the camera frames when a node is "open".
export function focusRect(board, id, mode) {
  const r = regionOf(board, id);
  return mode === 'nested' ? { x: r.x, y: r.y, s: r.s / 3 } : r;
}

export function liveChildren(board, id) {
  return board.nodes[id].children.filter((c) => c && board.nodes[c]);
}

export function computeProgress(board) {
  const memo = Object.create(null);
  const visit = (id) => {
    if (memo[id] !== undefined) return memo[id];
    const n = board.nodes[id];
    const kids = liveChildren(board, id);
    let v = 0;
    if (n.done) v = 1;
    else if (kids.length) v = kids.reduce((a, c) => a + visit(c), 0) / kids.length;
    memo[id] = v;
    return v;
  };
  for (const id in board.nodes) visit(id);
  return memo;
}

export function countDescendants(board, id) {
  let n = 0;
  for (const c of liveChildren(board, id)) n += 1 + countDescendants(board, c);
  return n;
}

export function depthOf(board) {
  const walk = (id) => 1 + Math.max(0, ...liveChildren(board, id).map(walk));
  return walk(board.rootId);
}

// Deepest node whose region contains (px,py) and whose focus square is still
// at least minS wide. Used to keep "where am I" in sync with free pinch/pan.
export function nodeAt(board, mode, px, py, minS) {
  let id = board.rootId;
  let r = { x: 0, y: 0, s: 1 };
  for (;;) {
    const n = board.nodes[id];
    let next = null;
    for (let i = 0; i < 8; i++) {
      const c = n.children[i];
      if (!c || !board.nodes[c]) continue;
      const [dx, dy] = dirOf(i);
      const cr = { x: r.x + (dx * r.s) / 3, y: r.y + (dy * r.s) / 3, s: r.s / 3 };
      const fs = mode === 'nested' ? cr.s / 3 : cr.s;
      if (Math.abs(px - cr.x) <= cr.s / 2 && Math.abs(py - cr.y) <= cr.s / 2 && fs >= minS) {
        next = { c, cr };
        break;
      }
    }
    if (!next) return id;
    id = next.c;
    r = next.cr;
  }
}

// ---- nested view geometry -------------------------------------------------
// The nested view is drawn relative to the open square ("frame"): its 3x3 block
// sits in the middle at size 1, and each step's own 3x3 block surrounds it at
// RING x that size. Each node's frame has a fixed place in one shared space, so
// moving between frames is just a change of coordinates.
export const RING = 0.8;
export const GAP = 0.07;
export const OFF = 0.5 + GAP + RING / 2;
export const NESTED_EXTENT = 2 * (OFF + RING / 2);

export function frameOf(board, id) {
  const path = pathTo(board, id);
  let ox = 0, oy = 0, sc = 1;
  for (let k = 1; k < path.length; k++) {
    const parent = board.nodes[path[k - 1]];
    const [dx, dy] = dirOf(parent.children.indexOf(path[k]));
    ox += dx * OFF * sc;
    oy += dy * OFF * sc;
    sc *= RING;
  }
  return { ox, oy, sc };
}

export function lowestCommonAncestor(board, a, b) {
  const pa = pathTo(board, a);
  const pb = new Set(pathTo(board, b));
  let lca = board.rootId;
  for (const id of pa) if (pb.has(id)) lca = id;
  return lca;
}

// Bounding square of what a view draws (for "zoom out to all").
export function contentBounds(board, mode, frameId) {
  if (mode !== 'nested') return { x: 0, y: 0, s: 1 };
  const id = frameId || board.rootId;
  return liveChildren(board, id).length ? { x: 0, y: 0, s: NESTED_EXTENT } : { x: 0, y: 0, s: 1 };
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Produce the list of visible items for a camera.
// cam: { cx, cy, scale, vw, vh, ox, oy, T }  (ox/oy = screen point the camera centre maps to)
// Item: { key, kind, role, nodeId, parentId, slot, x, y, size, opacity }
export function buildItems(board, cam, mode, minPx = 5, focusId = null, frameId = null) {
  const out = [];
  const nodes = board.nodes;
  const hasKids = (id) => nodes[id].children.some((c) => c && nodes[c]);
  const left = (0 - cam.ox) / cam.scale + cam.cx;
  const right = (cam.vw - cam.ox) / cam.scale + cam.cx;
  const top = (0 - cam.oy) / cam.scale + cam.cy;
  const bottom = (cam.vh - cam.oy) / cam.scale + cam.cy;
  const visible = (x, y, s) =>
    x + s / 2 >= left && x - s / 2 <= right && y + s / 2 >= top && y - s / 2 <= bottom;

  const cells = (id, x, y, s, op, peek) => {
    const c = s / 3;
    const n = nodes[id];
    out.push({ key: 'k' + id, kind: 'block', nodeId: id, x, y, size: s, opacity: op });
    out.push({ key: 'n' + id + '@c', kind: 'node', role: 'center', nodeId: id, x, y, size: c, opacity: op });
    for (let i = 0; i < 8; i++) {
      const [dx, dy] = dirOf(i);
      const cx = x + dx * c, cy = y + dy * c;
      if (!visible(cx, cy, c)) continue;
      const cid = n.children[i];
      if (cid && nodes[cid]) {
        out.push({ key: 'n' + cid + '@s', kind: 'node', role: 'child', nodeId: cid, parentId: id, slot: i, x: cx, y: cy, size: c, opacity: op, peek: peek && hasKids(cid) });
      } else {
        out.push({ key: 'e' + id + ':' + i, kind: 'empty', parentId: id, slot: i, x: cx, y: cy, size: c, opacity: op });
      }
    }
  };

  // Nested: the open square's block, plus each step's block around it.
  // Cells in the outer blocks that have steps of their own show a small map of them.
  const nested = (frame) => {
    cells(frame, 0, 0, 1, 1, false);
    const n = nodes[frame];
    for (let i = 0; i < 8; i++) {
      const c = n.children[i];
      if (!c || !nodes[c]) continue;
      const [dx, dy] = dirOf(i);
      const x = dx * OFF, y = dy * OFF;
      if (!visible(x, y, RING)) continue;
      cells(c, x, y, RING, 1, true);
    }
  };

  const fractal = (id, x, y, s, op, depth = 0) => {
    if (op <= 0.01 || !visible(x, y, s)) return;
    const px = s * cam.scale;
    // A step with nothing inside stays a card unless it's the open square.
    const t = !hasKids(id) && id !== focusId && depth > 0 ? 0 : smooth((px - cam.T * 0.8) / (cam.T * 0.4));
    if (t < 1) out.push({ key: 'n' + id + '@k', kind: 'node', role: 'card', nodeId: id, x, y, size: s, opacity: op * (1 - t) });
    if (t <= 0 || px / 3 < minPx) return;
    const c = s / 3;
    const o = op * t;
    out.push({ key: 'f' + id, kind: 'frame', nodeId: id, x, y, size: s, opacity: o });
    out.push({ key: 'n' + id + '@c', kind: 'node', role: 'center', nodeId: id, x, y, size: c, opacity: o });
    const n = nodes[id];
    for (let i = 0; i < 8; i++) {
      const [dx, dy] = dirOf(i);
      const cx = x + dx * c, cy = y + dy * c;
      const cid = n.children[i];
      if (cid && nodes[cid]) fractal(cid, cx, cy, c, o, depth + 1);
      else if (visible(cx, cy, c)) out.push({ key: 'e' + id + ':' + i, kind: 'empty', parentId: id, slot: i, x: cx, y: cy, size: c, opacity: o });
    }
  };

  if (mode === 'nested') nested(frameId && nodes[frameId] ? frameId : board.rootId);
  else fractal(board.rootId, 0, 0, 1, 1);
  return out;
}
