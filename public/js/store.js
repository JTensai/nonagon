import { fire, firebaseEnabled } from './firebase.js';

export const newId = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function blankNode(id, text, parent) {
  return { id, text, done: false, parent, children: [null, null, null, null, null, null, null, null] };
}

export function makeBoard(ownerId, goal) {
  const rootId = newId();
  const now = Date.now();
  return {
    id: newId(),
    ownerId,
    title: goal,
    rootId,
    nodes: { [rootId]: blankNode(rootId, goal, null) },
    public: false,
    createdAt: now,
    updatedAt: now,
  };
}

// Example board so new users can see a chart that's already broken down.
export function exampleBoard(ownerId) {
  const b = makeBoard(ownerId, 'Run my first half marathon');
  const add = (parentId, slot, text, done = false) => {
    const id = newId();
    b.nodes[id] = blankNode(id, text, parentId);
    b.nodes[id].done = done;
    b.nodes[parentId].children[slot] = id;
    return id;
  };
  const r = b.rootId;
  const base = add(r, 0, 'Build an easy running base');
  add(r, 1, 'Sign up for a race in spring', true);
  const gear = add(r, 2, 'Get the right gear');
  add(r, 3, 'Find a running buddy');
  const plan = add(r, 4, 'Follow a 12-week plan');
  add(r, 5, 'Sleep 8 hours on training days');
  const fuel = add(r, 6, 'Learn to fuel long runs');
  add(r, 7, 'Log every run');
  add(base, 0, 'Run 3 times a week', true);
  add(base, 1, 'Keep every run conversational', true);
  add(base, 2, 'Long run on Saturdays');
  add(base, 3, 'Add no more than 10% a week');
  add(base, 5, 'Take rest days seriously', true);
  add(gear, 0, 'Get fitted for shoes', true);
  add(gear, 2, 'Buy a running watch');
  add(gear, 6, 'Socks that don’t blister', true);
  add(plan, 0, 'Weeks 1–4: build');
  add(plan, 2, 'Weeks 5–8: distance');
  add(plan, 6, 'Weeks 9–11: speed');
  add(plan, 7, 'Week 12: taper');
  add(fuel, 1, 'Try gels on a long run');
  add(fuel, 4, 'Plan race-morning breakfast');
  return b;
}

class LocalStore {
  constructor() {
    this.key = 'nonagon.demo.boards';
    this.mem = null;
    this.listeners = new Set();
    this.supportsSharing = false;
  }
  all() {
    if (this.mem) return this.mem;
    try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch { return (this.mem = {}); }
  }
  put(all) {
    try { localStorage.setItem(this.key, JSON.stringify(all)); } catch { this.mem = all; }
    const list = this.list(all);
    this.listeners.forEach((f) => f(list));
  }
  list(all) { return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt); }
  async watchBoards(_uid, cb) {
    this.listeners.add(cb);
    cb(this.list(this.all()));
    return () => this.listeners.delete(cb);
  }
  async getBoard(id) {
    const b = this.all()[id];
    return b ? structuredClone(b) : null;
  }
  async saveBoard(b) {
    const all = this.all();
    all[b.id] = structuredClone(b);
    this.put(all);
  }
  async deleteBoard(id) {
    const all = this.all();
    delete all[id];
    this.put(all);
  }
}

class CloudStore {
  constructor() { this.supportsSharing = true; }
  async watchBoards(uid, cb, onError) {
    const { db, fs } = await fire();
    const q = fs.query(fs.collection(db, 'boards'), fs.where('ownerId', '==', uid));
    return fs.onSnapshot(
      q,
      (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => b.updatedAt - a.updatedAt)),
      (err) => { console.error(err); onError?.(err); },
    );
  }
  async getBoard(id) {
    const { db, fs } = await fire();
    const snap = await fs.getDoc(fs.doc(db, 'boards', id));
    return snap.exists() ? { ...snap.data(), id: snap.id } : null;
  }
  async saveBoard(b) {
    const { db, fs } = await fire();
    const { id, ...data } = b;
    await fs.setDoc(fs.doc(db, 'boards', id), JSON.parse(JSON.stringify(data)));
  }
  async deleteBoard(id) {
    const { db, fs } = await fire();
    await fs.deleteDoc(fs.doc(db, 'boards', id));
  }
}

export const store = firebaseEnabled ? new CloudStore() : new LocalStore();
