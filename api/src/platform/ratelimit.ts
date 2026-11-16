export class RateLimiter {
  private hits = new Map<string, number[]>();
  /** returns true if allowed */
  allow(key: string, limit: number, windowMs: number, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= limit) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some(t => now - t < windowMs)) this.hits.delete(k);
    return true;
  }
}
