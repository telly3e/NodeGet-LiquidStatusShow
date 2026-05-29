const DEFAULT_BUCKET_MS = 60 * 1000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 55 * 1000;
const DEFAULT_SEGMENT_MS = 60 * 60 * 1000;
const DEFAULT_INCREMENTAL_OVERLAP_MS = 2 * 60 * 1000;
const DEFAULT_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_RAW_QUERY_LIMIT = 40000;
const DEFAULT_KV_NAMESPACE = "latency_aggregate_cache";
const TYPES = new Set(["tcp_ping", "ping"]);
const refreshJobs = new Map();
const INDEX_KEY = "latency:v1:index";

function envValue(env, key, fallback = "") {
  return env[key] ?? env[key.toLowerCase()] ?? fallback;
}

function envNumber(env, key, fallback) {
  const value = Number(envValue(env, key, ""));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function parseRouteParams(request) {
  const url = new URL(request.url);
  const fromQuery = {
    uuid: url.searchParams.get("uuid") || "",
    type: url.searchParams.get("type") || "tcp_ping",
    from: Number(url.searchParams.get("from") || 0) || 0,
    to: Number(url.searchParams.get("to") || Date.now()) || Date.now(),
    cron_source: (url.searchParams.get("cron_source") || "").trim(),
  };

  if (request.method !== "POST") {
    return fromQuery;
  }

  try {
    const body = await request.json();
    return {
      uuid: String(body?.uuid || fromQuery.uuid || "").trim(),
      type: String(body?.type || fromQuery.type || "tcp_ping").trim(),
      from: Number(body?.from || fromQuery.from || 0) || 0,
      to: Number(body?.to || fromQuery.to || Date.now()) || Date.now(),
      cron_source: String(body?.cron_source || fromQuery.cron_source || "").trim(),
    };
  } catch {
    return fromQuery;
  }
}

async function rpc(env, method, params = {}) {
  const base = String(envValue(env, "RPC_BASE_URL", "")).replace(/\/+$/, "");
  const token = envValue(env, "TOKEN", "");
  if (!base) throw new Error("RPC_BASE_URL is missing");
  if (!token) throw new Error("TOKEN is missing");

  const response = await fetch(`${base}/jsonrpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: {
        token,
        ...params,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`rpc ${method} http ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `rpc ${method} failed`);
  }
  return payload.result;
}

async function kvRead(env, key) {
  const namespace = envValue(env, "KV_NAMESPACE", DEFAULT_KV_NAMESPACE);

  try {
    const value = await rpc(env, "kv_get_value", { namespace, key });
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {}

  try {
    const rows = await rpc(env, "kv_get_multi_value", {
      namespace_key: [{ namespace, key }],
    });
    const value = Array.isArray(rows) ? rows[0]?.value : null;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {}

  return null;
}

async function kvWrite(env, key, value) {
  const namespace = envValue(env, "KV_NAMESPACE", DEFAULT_KV_NAMESPACE);
  const encoded = JSON.stringify(value);

  try {
    await rpc(env, "kv_put_value", { namespace, key, value: encoded });
    return true;
  } catch {}

  try {
    await rpc(env, "kv_set_value", { namespace, key, value: encoded });
    return true;
  } catch {}

  return false;
}

async function kvDelete(env, key) {
  const namespace = envValue(env, "KV_NAMESPACE", DEFAULT_KV_NAMESPACE);

  try {
    await rpc(env, "kv_delete_value", { namespace, key });
    return true;
  } catch {}

  try {
    await rpc(env, "kv_remove_value", { namespace, key });
    return true;
  } catch {}

  return false;
}

function bucketStart(timestamp, bucketMs) {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function normalizeTimestamp(timestamp) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function aggregateRows(rows, type, bucketMs) {
  const groups = new Map();

  for (const row of rows || []) {
    const timestamp = normalizeTimestamp(Number(row.timestamp || 0));
    const cronSource = String(row.cron_source || "").trim();
    if (!timestamp || !cronSource) continue;

    const start = bucketStart(timestamp, bucketMs);
    const key = `${start}:${cronSource}`;
    const value = row?.task_event_result?.[type];
    let group = groups.get(key);

    if (!group) {
      group = {
        timestamp: start + Math.floor(bucketMs / 2),
        uuid: String(row.uuid || ""),
        cron_source: cronSource,
        task_id: Number(row.task_id || 0),
        success_count: 0,
        failure_count: 0,
        sample_count: 0,
        sum: 0,
      };
      groups.set(key, group);
    }

    group.sample_count += 1;
    if (typeof value === "number" && row.success) {
      group.success_count += 1;
      group.sum += value;
    } else {
      group.failure_count += 1;
    }
  }

  return [...groups.values()]
    .map(group => {
      const avg = group.success_count ? group.sum / group.success_count : null;
      return {
        task_id: group.task_id,
        timestamp: group.timestamp,
        uuid: group.uuid,
        success: group.success_count > 0,
        error_message: group.failure_count && !group.success_count ? "all samples failed" : null,
        cron_source: group.cron_source,
        task_event_result: {
          [type]: avg,
          bucket_ms: bucketMs,
          sample_count: group.sample_count,
          success_count: group.success_count,
          failure_count: group.failure_count,
        },
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function filterRows(rows, from, to, cronSource) {
  return (rows || []).filter(row => {
    const timestamp = Number(row.timestamp || 0);
    if (from && timestamp < from) return false;
    if (to && timestamp > to) return false;
    if (cronSource && row.cron_source !== cronSource) return false;
    return true;
  });
}

function cacheKey(type, uuid) {
  return `latency:v1:${type}:${uuid}`;
}

function rowKey(row) {
  return `${String(row.uuid || "")}|${Number(row.timestamp || 0)}|${String(row.cron_source || "")}`;
}

function latestRowTimestamp(rows) {
  let max = 0;
  for (const row of rows || []) {
    const timestamp = Number(row.timestamp || 0);
    if (timestamp > max) max = timestamp;
  }
  return max;
}

function mergeAggregatedRows(prevRows, incomingRows, cutoff) {
  const map = new Map();
  for (const row of prevRows || []) {
    if (Number(row.timestamp || 0) >= cutoff) {
      map.set(rowKey(row), row);
    }
  }
  for (const row of incomingRows || []) {
    if (Number(row.timestamp || 0) >= cutoff) {
      map.set(rowKey(row), row);
    }
  }
  return [...map.values()].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

function buildSegments(from, to, segmentMs) {
  const segments = [];
  for (let start = from; start < to; start += segmentMs) {
    segments.push([start, Math.min(start + segmentMs, to)]);
  }
  return segments;
}

function indexEntry(key, payload, now) {
  return {
    key,
    uuid: String(payload?.uuid || ""),
    type: String(payload?.type || ""),
    generated_at: Number(payload?.generated_at || now) || now,
    retention_ms: Number(payload?.retention_ms || 0) || 0,
    touched_at: now,
  };
}

async function readIndex(env) {
  const index = await kvRead(env, INDEX_KEY);
  if (!index || typeof index !== "object") {
    return {
      version: 1,
      updated_at: 0,
      entries: [],
    };
  }

  return {
    version: 1,
    updated_at: Number(index.updated_at || 0) || 0,
    entries: Array.isArray(index.entries) ? index.entries : [],
  };
}

async function writeIndex(env, index) {
  const payload = {
    version: 1,
    updated_at: Date.now(),
    entries: Array.isArray(index?.entries) ? index.entries : [],
  };
  await kvWrite(env, INDEX_KEY, payload);
  return payload;
}

async function touchIndex(env, key, payload, now) {
  const index = await readIndex(env);
  const entries = new Map((index.entries || []).map(entry => [entry.key, entry]));
  entries.set(key, indexEntry(key, payload, now));
  return writeIndex(env, { entries: [...entries.values()] });
}

async function cleanupExpiredKeys(env, now, force = false) {
  const cleanupGraceMs = envNumber(env, "CLEANUP_GRACE_MS", DEFAULT_CLEANUP_GRACE_MS);
  const cleanupIntervalMs = envNumber(env, "CLEANUP_INTERVAL_MS", DEFAULT_CLEANUP_INTERVAL_MS);
  const index = await readIndex(env);

  if (!force && index.updated_at && now - index.updated_at < cleanupIntervalMs) {
    return { skipped: true, removed: [], retained: index.entries || [] };
  }

  const retained = [];
  const removed = [];

  for (const entry of index.entries || []) {
    const generatedAt = Number(entry?.generated_at || 0) || 0;
    const retentionMs = Number(entry?.retention_ms || 0) || 0;
    const expiresAt = generatedAt + retentionMs + cleanupGraceMs;

    if (generatedAt && retentionMs && expiresAt < now) {
      const deleted = await kvDelete(env, entry.key);
      removed.push({
        key: entry.key,
        deleted,
      });
      continue;
    }

    retained.push(entry);
  }

  await writeIndex(env, { entries: retained });
  return { skipped: false, removed, retained };
}

async function readTaskRows(env, uuid, type, from, to) {
  const limit = envNumber(env, "RAW_QUERY_LIMIT", DEFAULT_RAW_QUERY_LIMIT);
  return rpc(env, "task_query", {
    task_data_query: {
      condition: [
        { uuid },
        { type },
        { timestamp_from_to: [from, to] },
        { limit },
      ],
    },
  });
}

async function aggregateWindow(env, uuid, type, from, to) {
  const bucketMs = envNumber(env, "BUCKET_MS", DEFAULT_BUCKET_MS);
  const segmentMs = envNumber(env, "SEGMENT_MS", DEFAULT_SEGMENT_MS);
  const segments = buildSegments(from, to, segmentMs);
  const rows = [];

  for (const [segmentFrom, segmentTo] of segments) {
    const rawRows = await readTaskRows(env, uuid, type, segmentFrom, segmentTo);
    rows.push(...aggregateRows(rawRows, type, bucketMs));
  }

  return mergeAggregatedRows([], rows, from);
}

async function rebuildCache(env, uuid, type, now) {
  const bucketMs = envNumber(env, "BUCKET_MS", DEFAULT_BUCKET_MS);
  const retentionMs = envNumber(env, "RETENTION_MS", DEFAULT_RETENTION_MS);
  const from = now - retentionMs;
  const rows = await aggregateWindow(env, uuid, type, from, now);
  const payload = {
    version: 1,
    generated_at: now,
    bucket_ms: bucketMs,
    retention_ms: retentionMs,
    uuid,
    type,
    rows,
  };

  const written = await kvWrite(env, cacheKey(type, uuid), payload);
  if (written) {
    await touchIndex(env, cacheKey(type, uuid), payload, now);
  }
  return { ...payload, cache_written: written };
}

async function refreshCache(env, cached, uuid, type, now) {
  const bucketMs = envNumber(env, "BUCKET_MS", DEFAULT_BUCKET_MS);
  const retentionMs = envNumber(env, "RETENTION_MS", DEFAULT_RETENTION_MS);
  const overlapMs = envNumber(env, "INCREMENTAL_OVERLAP_MS", DEFAULT_INCREMENTAL_OVERLAP_MS);
  const cutoff = now - retentionMs;

  if (!cached || !Array.isArray(cached.rows) || !cached.rows.length) {
    return rebuildCache(env, uuid, type, now);
  }

  if (
    Number(cached.bucket_ms || 0) !== bucketMs ||
    Number(cached.retention_ms || 0) !== retentionMs
  ) {
    return rebuildCache(env, uuid, type, now);
  }

  const latestTs = latestRowTimestamp(cached.rows);
  if (!latestTs || latestTs < cutoff) {
    return rebuildCache(env, uuid, type, now);
  }

  const updateFrom = Math.max(cutoff, latestTs - overlapMs);
  const incomingRows = await aggregateWindow(env, uuid, type, updateFrom, now);
  const rows = mergeAggregatedRows(cached.rows, incomingRows, cutoff);
  const payload = {
    ...cached,
    generated_at: now,
    bucket_ms: bucketMs,
    retention_ms: retentionMs,
    uuid,
    type,
    rows,
  };

  const written = await kvWrite(env, cacheKey(type, uuid), payload);
  if (written) {
    await touchIndex(env, cacheKey(type, uuid), payload, now);
  }
  return { ...payload, cache_written: written };
}

async function getCachedOrRebuild(env, uuid, type, now) {
  const cacheTtlMs = envNumber(env, "CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const cached = await kvRead(env, cacheKey(type, uuid));
  if (cached && now - Number(cached.generated_at || 0) < cacheTtlMs) {
    return cached;
  }

  const key = cacheKey(type, uuid);
  let job = refreshJobs.get(key);
  if (!job) {
    job = (cached ? refreshCache(env, cached, uuid, type, now) : rebuildCache(env, uuid, type, now))
      .finally(() => refreshJobs.delete(key));
    refreshJobs.set(key, job);
  }
  return job;
}

async function listAllAgentUuids(env) {
  try {
    const result = await rpc(env, "agent-uuid.list_all", {});
    if (Array.isArray(result)) {
      return result
        .map(item => (typeof item === "string" ? item : item?.uuid))
        .filter(Boolean);
    }
  } catch {}

  try {
    const result = await rpc(env, "nodeget-server_list_all_agent_uuid", {});
    return Array.isArray(result?.uuids) ? result.uuids : [];
  } catch {}

  return [];
}

export default {
  async onCall(params, env) {
    const uuid = String(params?.uuid || "").trim();
    const type = String(params?.type || "tcp_ping").trim();
    const cleanup = String(params?.cleanup || "").trim().toLowerCase();

    if (cleanup === "true" || cleanup === "1" || cleanup === "force") {
      const result = await cleanupExpiredKeys(env, Date.now(), true);
      return {
        ok: true,
        cleanup: result,
      };
    }

    if (!uuid || !TYPES.has(type)) {
      return { ok: false, error: "uuid and valid type are required" };
    }
    await cleanupExpiredKeys(env, Date.now(), false);
    const payload = await rebuildCache(env, uuid, type, Date.now());
    return {
      ok: true,
      generated_at: payload.generated_at,
      rows: payload.rows.length,
      cache_written: payload.cache_written,
    };
  },

  async onCron(_params, env) {
    const configured = parseList(envValue(env, "PREFETCH_UUIDS", ""));
    const types = parseList(envValue(env, "PREFETCH_TYPES", "tcp_ping,ping")).filter(type => TYPES.has(type));
    const uuids =
      configured.length === 1 && (configured[0] === "*" || configured[0].toLowerCase() === "all")
        ? await listAllAgentUuids(env)
        : configured;

    if (!uuids.length || !types.length) {
      return { ok: true, skipped: true, reason: "no PREFETCH_UUIDS or PREFETCH_TYPES configured" };
    }

    const now = Date.now();
    const cleanup = await cleanupExpiredKeys(env, now, true);
    const refreshed = [];
    for (const uuid of uuids) {
      for (const type of types) {
        const payload = await rebuildCache(env, uuid, type, now);
        refreshed.push({
          uuid,
          type,
          rows: payload.rows.length,
          cache_written: payload.cache_written,
        });
      }
    }

    return {
      ok: true,
      cleanup,
      refreshed,
    };
  },

  async onRoute(request, env) {
    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "POST is required" }, 405);
    }

    const { uuid, type, from, to, cron_source: cronSource } = await parseRouteParams(request);

    if (!uuid) return json({ ok: false, error: "uuid is required" }, 400);
    if (!TYPES.has(type)) return json({ ok: false, error: "type must be tcp_ping or ping" }, 400);

    await cleanupExpiredKeys(env, Date.now(), false);
    const payload = await getCachedOrRebuild(env, uuid, type, Date.now());
    return json({
      ok: true,
      generated_at: payload.generated_at,
      bucket_ms: payload.bucket_ms,
      retention_ms: payload.retention_ms,
      uuid,
      type,
      rows: filterRows(payload.rows, from, to, cronSource),
    });
  },
};
