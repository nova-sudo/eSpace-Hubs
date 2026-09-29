/**
 * A tiny in-memory stand-in for a Mongo `Collection`, for unit tests that
 * run without a database (the API test suite points MONGO_URI at a dead
 * port). Supports exactly the query shapes the code under test uses:
 * equality (ObjectId-aware, dotted paths), `$in`, `$ne`, `$exists`,
 * `null` matching a missing field, `sort` by one or more keys, `limit`,
 * and `$set` / `$unset` / upsert on update. Not a general Mongo emulator.
 */

import { ObjectId } from "mongodb";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = Record<string, any>;

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const keys = path.split(".");
  let o: Doc = doc;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function unsetPath(doc: Doc, path: string): void {
  const keys = path.split(".");
  const parent = getPath(doc, keys.slice(0, -1).join(".")) as Doc | undefined;
  const target = keys.length === 1 ? doc : parent;
  if (target) delete target[keys[keys.length - 1]];
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (b === null) return a === null || a === undefined;
  return a === b;
}

function matchCond(value: unknown, cond: unknown): boolean {
  if (
    cond &&
    typeof cond === "object" &&
    !(cond instanceof ObjectId) &&
    !(cond instanceof Date) &&
    Object.keys(cond).some((k) => k.startsWith("$"))
  ) {
    const c = cond as Doc;
    if ("$in" in c && !(c.$in as unknown[]).some((x) => eq(value, x))) return false;
    if ("$ne" in c && eq(value, c.$ne)) return false;
    if ("$exists" in c && (value !== undefined) !== Boolean(c.$exists)) return false;
    return true;
  }
  return eq(value, cond);
}

/** Deep copy that keeps ObjectId / Date instances (structuredClone doesn't). */
function clone<T>(v: T): T {
  if (v instanceof ObjectId) return new ObjectId(v.toHexString()) as T;
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  }
  return v;
}

export function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return (cond as Doc[]).some((f) => matches(doc, f));
    return matchCond(getPath(doc, k), cond);
  });
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av === undefined || av === null) return -1;
  if (bv === undefined || bv === null) return 1;
  return (av as any) < (bv as any) ? -1 : 1;
}

function sortDocs(docs: Doc[], sort: Doc | undefined): Doc[] {
  if (!sort) return docs;
  const keys = Object.entries(sort);
  return [...docs].sort((x, y) => {
    for (const [k, dir] of keys) {
      const c = compare(getPath(x, k), getPath(y, k));
      if (c !== 0) return c * (dir === -1 ? -1 : 1);
    }
    return 0;
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [k, v] of Object.entries(update.$set ?? {})) setPath(doc, k, v);
  for (const k of Object.keys(update.$unset ?? {})) unsetPath(doc, k);
}

export class FakeCollection {
  docs: Doc[];

  constructor(seed: Doc[] = []) {
    this.docs = seed.map((d) => ({ _id: new ObjectId(), ...d }));
  }

  async findOne(filter: Doc, opts: { sort?: Doc } = {}): Promise<any> {
    const hits = sortDocs(this.docs.filter((d) => matches(d, filter)), opts.sort);
    return hits[0] ? clone(hits[0]) : null;
  }

  find(filter: Doc = {}) {
    let sort: Doc | undefined;
    let limit: number | undefined;
    const cursor = {
      sort: (s: Doc) => {
        sort = s;
        return cursor;
      },
      limit: (n: number) => {
        limit = n;
        return cursor;
      },
      toArray: async () => {
        const hits = sortDocs(this.docs.filter((d) => matches(d, filter)), sort);
        return (limit ? hits.slice(0, limit) : hits).map((d) => clone(d));
      },
    };
    return cursor;
  }

  async insertOne(doc: Doc) {
    const row = { _id: new ObjectId(), ...doc };
    this.docs.push(clone(row));
    return { acknowledged: true, insertedId: row._id };
  }

  async updateOne(filter: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    const hit = this.docs.find((d) => matches(d, filter));
    if (hit) {
      applyUpdate(hit, update);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (opts.upsert) {
      const row: Doc = { _id: new ObjectId() };
      for (const [k, v] of Object.entries(filter)) {
        if (!k.startsWith("$")) setPath(row, k, v);
      }
      applyUpdate(row, update);
      this.docs.push(row);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }

  async updateMany(filter: Doc, update: Doc) {
    const hits = this.docs.filter((d) => matches(d, filter));
    for (const d of hits) applyUpdate(d, update);
    return { matchedCount: hits.length, modifiedCount: hits.length };
  }

  async deleteOne(filter: Doc) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i < 0) return { deletedCount: 0 };
    this.docs.splice(i, 1);
    return { deletedCount: 1 };
  }
}

/** Cast a fake to whatever collection type the code under test expects. */
export function asCollection<T>(fake: FakeCollection): T {
  return fake as unknown as T;
}
