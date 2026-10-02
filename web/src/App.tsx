import { Fragment, useEffect, useMemo, useState } from "react";
import {
  formatDuration,
  generateJobs,
  LOG_LINES,
  relativeTime,
  tickJob,
  type Job,
  type JobStatus,
} from "./data/jobs";

type SummaryTab = "timeseries" | "scatter";
type DrawerTab = "overview" | "logs";
type GroupBy = "none" | "queue" | "service" | "worker" | "env";

const STATUS_ORDER: JobStatus[] = [
  "running",
  "queued",
  "succeeded",
  "failed",
  "cancelled",
];

function Sparkline({
  values,
  color = "#1bbf8c",
}: {
  values: number[];
  color?: string;
}) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const w = 72;
  const h = 22;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}

function TimeseriesChart({ jobs }: { jobs: Job[] }) {
  const series = useMemo(() => {
    const len = 24;
    const running = Array.from({ length: len }, (_, i) => {
      const base = jobs.filter((j) => j.status === "running").length;
      return Math.max(0, base + Math.round(Math.sin(i / 3) * 2));
    });
    const failed = Array.from({ length: len }, (_, i) => {
      const base = jobs.filter((j) => j.status === "failed").length;
      return Math.max(0, Math.round(base * (0.4 + (i % 5) * 0.08)));
    });
    return { running, failed };
  }, [jobs]);

  const w = 420;
  const h = 110;
  const max = Math.max(...series.running, ...series.failed, 1);

  const path = (vals: number[]) =>
    vals
      .map((v, i) => {
        const x = (i / Math.max(vals.length - 1, 1)) * w;
        const y = h - (v / max) * (h - 12) - 6;
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ");

  return (
    <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} role="img">
      <title>Job throughput over the last minutes</title>
      {[0.25, 0.5, 0.75].map((p) => (
        <line
          key={p}
          x1="0"
          x2={w}
          y1={h * p}
          y2={h * p}
          stroke="#d5e2ea"
          strokeDasharray="3 4"
        />
      ))}
      <path d={path(series.running)} fill="none" stroke="#1bbf8c" strokeWidth="2.2" />
      <path d={path(series.failed)} fill="none" stroke="#d64550" strokeWidth="2" />
    </svg>
  );
}

function ScatterChart({ jobs }: { jobs: Job[] }) {
  const points = jobs.filter((j) => j.status === "running" || j.status === "succeeded");
  const w = 420;
  const h = 110;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} role="img">
      <title>CPU vs memory saturation</title>
      <line x1="28" y1={h - 14} x2={w - 8} y2={h - 14} stroke="#c5d6e0" />
      <line x1="28" y1="8" x2="28" y2={h - 14} stroke="#c5d6e0" />
      {points.map((j) => {
        const x = 28 + (j.cpuPct / 100) * (w - 44);
        const y = h - 14 - (j.memMb / j.memLimitMb) * (h - 28);
        const r = 3 + Math.min(j.retries, 3);
        const fill = j.status === "running" ? "#1bbf8c" : "#1a6f9a";
        return <circle key={j.id} cx={x} cy={y} r={r} fill={fill} opacity={0.75} />;
      })}
      <text x="32" y="14" fill="#6b8596" fontSize="9" fontFamily="IBM Plex Mono, monospace">
        mem %
      </text>
      <text
        x={w - 42}
        y={h - 3}
        fill="#6b8596"
        fontSize="9"
        fontFamily="IBM Plex Mono, monospace"
      >
        cpu %
      </text>
    </svg>
  );
}

function Meter({
  value,
  max,
  label,
  hot,
  kind = "cpu",
}: {
  value: number;
  max: number;
  label: string;
  hot?: boolean;
  kind?: "cpu" | "mem";
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={`meter ${kind} ${hot ? "hot" : ""}`}>
      <span>{label}</span>
      <div className="bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span>{pct}%</span>
    </div>
  );
}

function matchesQuery(job: Job, q: string): boolean {
  if (!q.trim()) return true;
  const hay = [
    job.name,
    job.id,
    job.queue,
    job.worker,
    job.service,
    job.env,
    job.image,
    job.status,
  ]
    .join(" ")
    .toLowerCase();

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    if (token.startsWith("status:")) return job.status === token.slice(7);
    if (token.startsWith("queue:")) return job.queue === token.slice(6);
    if (token.startsWith("service:")) return job.service === token.slice(8);
    if (token.startsWith("env:")) return job.env === token.slice(4);
    if (token.startsWith("!")) return !hay.includes(token.slice(1));
    return hay.includes(token);
  });
}

function countBy<T extends string>(jobs: Job[], key: (j: Job) => T): Record<string, number> {
  return jobs.reduce<Record<string, number>>((acc, job) => {
    const k = key(job);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

export default function App() {
  const [jobs, setJobs] = useState(() => generateJobs());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [facetQueue, setFacetQueue] = useState<string | null>(null);
  const [facetService, setFacetService] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [summaryTab, setSummaryTab] = useState<SummaryTab>("timeseries");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      setJobs((prev) => prev.map((j, i) => tickJob(j, Date.now() + i)));
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (facetQueue && job.queue !== facetQueue) return false;
      if (facetService && job.service !== facetService) return false;
      return matchesQuery(job, query);
    });
  }, [jobs, query, statusFilter, facetQueue, facetService]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const statusCounts = countBy(jobs, (j) => j.status);
  const filteredStatusCounts = countBy(filtered, (j) => j.status);
  const queueCounts = countBy(jobs, (j) => j.queue);
  const serviceCounts = countBy(jobs, (j) => j.service);

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", rows: filtered }];
    const map = new Map<string, Job[]>();
    for (const job of filtered) {
      const key = String(job[groupBy]);
      const list = map.get(key) ?? [];
      list.push(job);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({ key, rows }));
  }, [filtered, groupBy]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            Jw
          </div>
          <div>
            <h1>JobWatch</h1>
            <p>Jobs Explorer · live resource view</p>
          </div>
        </div>
        <div className="live-pill" title="Metrics refresh every 2s while this page is open">
          Live · 2s
        </div>
      </header>

      <div className="shell">
        <aside className="facets" aria-label="Facets">
          <h2>Facets</h2>

          <div className="facet-group">
            <h3>Status</h3>
            <div className="facet-list">
              <button
                type="button"
                className={`facet-item ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                <span>All</span>
                <span>{jobs.length}</span>
              </button>
              {STATUS_ORDER.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`facet-item ${statusFilter === status ? "active" : ""}`}
                  onClick={() => setStatusFilter(status)}
                >
                  <span>{status}</span>
                  <span>{statusCounts[status] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="facet-group">
            <h3>Queue</h3>
            <div className="facet-list">
              {Object.entries(queueCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([queue, count]) => (
                  <button
                    key={queue}
                    type="button"
                    className={`facet-item ${facetQueue === queue ? "active" : ""}`}
                    onClick={() =>
                      setFacetQueue((prev) => (prev === queue ? null : queue))
                    }
                  >
                    <span>{queue}</span>
                    <span>{count}</span>
                  </button>
                ))}
            </div>
          </div>

          <div className="facet-group">
            <h3>Service</h3>
            <div className="facet-list">
              {Object.entries(serviceCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([service, count]) => (
                  <button
                    key={service}
                    type="button"
                    className={`facet-item ${facetService === service ? "active" : ""}`}
                    onClick={() =>
                      setFacetService((prev) => (prev === service ? null : service))
                    }
                  >
                    <span>{service}</span>
                    <span>{count}</span>
                  </button>
                ))}
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="toolbar">
            <label className="search">
              <span aria-hidden>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search jobs — try status:failed service:billing"
                aria-label="Search jobs"
              />
              <kbd>/</kbd>
            </label>
            <div className="toolbar-meta">
              <select
                className="select"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                aria-label="Group by"
              >
                <option value="none">Group: none</option>
                <option value="queue">Group: queue</option>
                <option value="service">Group: service</option>
                <option value="worker">Group: worker</option>
                <option value="env">Group: env</option>
              </select>
              <button
                type="button"
                className={`chip ${summaryOpen ? "active" : ""}`}
                onClick={() => setSummaryOpen((v) => !v)}
              >
                Summary graphs
              </button>
            </div>
          </div>

          <section className="summary" aria-label="Summary graphs">
            <div className="summary-head">
              <h2>
                {filtered.length} jobs
                {(facetQueue || facetService || statusFilter !== "all" || query) &&
                  " · filtered"}
              </h2>
              <div className="tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={summaryTab === "timeseries" ? "active" : ""}
                  aria-selected={summaryTab === "timeseries"}
                  onClick={() => setSummaryTab("timeseries")}
                >
                  Timeseries
                </button>
                <button
                  type="button"
                  role="tab"
                  className={summaryTab === "scatter" ? "active" : ""}
                  aria-selected={summaryTab === "scatter"}
                  onClick={() => setSummaryTab("scatter")}
                >
                  Scatter
                </button>
              </div>
            </div>
            <div className={`summary-body ${summaryOpen ? "" : "collapsed"}`}>
              <div className="stat-strip">
                <div className="stat running">
                  <label>Running</label>
                  <strong>{filteredStatusCounts.running ?? 0}</strong>
                </div>
                <div className="stat queued">
                  <label>Queued</label>
                  <strong>{filteredStatusCounts.queued ?? 0}</strong>
                </div>
                <div className="stat succeeded">
                  <label>Succeeded</label>
                  <strong>{filteredStatusCounts.succeeded ?? 0}</strong>
                </div>
                <div className="stat failed">
                  <label>Failed</label>
                  <strong>{filteredStatusCounts.failed ?? 0}</strong>
                </div>
              </div>
              <div className="chart-pane">
                <h3>
                  {summaryTab === "timeseries"
                    ? "Running vs failed (recent window)"
                    : "CPU × memory by job"}
                </h3>
                {summaryTab === "timeseries" ? (
                  <TimeseriesChart jobs={filtered} />
                ) : (
                  <ScatterChart jobs={filtered} />
                )}
              </div>
            </div>
          </section>

          <div className="pivot-bar">
            <span>
              Pivot like Containers Explorer — group fleets by queue, service, worker,
              or env.
            </span>
          </div>

          <div className="table-wrap">
            {filtered.length === 0 ? (
              <div className="empty">No jobs match this query.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>CPU</th>
                    <th>Memory</th>
                    <th>Trend</th>
                    <th>Queue</th>
                    <th>Worker</th>
                    <th>Duration</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((group) => (
                    <Fragment key={group.key}>
                      {groupBy !== "none" && (
                        <tr>
                          <td
                            colSpan={9}
                            style={{
                              background: "#eef5f8",
                              fontWeight: 600,
                              color: "#3a5363",
                            }}
                          >
                            {groupBy}: {group.key}
                            <span className="mono" style={{ marginLeft: 8 }}>
                              {group.rows.length}
                            </span>
                          </td>
                        </tr>
                      )}
                      {group.rows.map((job) => (
                        <tr
                          key={job.id}
                          className={selectedId === job.id ? "selected" : ""}
                          onClick={() => {
                            setSelectedId(job.id);
                            setDrawerTab("overview");
                          }}
                        >
                          <td>
                            <div className="name-cell">
                              <strong>{job.name}</strong>
                              <span>{job.id}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status ${job.status}`}>{job.status}</span>
                          </td>
                          <td>
                            <Meter
                              value={job.cpuPct}
                              max={100}
                              label={`${job.cpuPct}%`}
                              hot={job.cpuPct > 85}
                            />
                          </td>
                          <td>
                            <Meter
                              kind="mem"
                              value={job.memMb}
                              max={job.memLimitMb}
                              label={`${job.memMb}`}
                              hot={job.memMb / job.memLimitMb > 0.85}
                            />
                          </td>
                          <td>
                            <Sparkline
                              values={job.sparkCpu}
                              color={job.status === "failed" ? "#d64550" : "#1bbf8c"}
                            />
                          </td>
                          <td className="mono">{job.queue}</td>
                          <td className="mono">{job.worker}</td>
                          <td className="mono">{formatDuration(job.durationSec)}</td>
                          <td className="mono">{relativeTime(job.startedAt, now)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      <div
        className={`drawer-backdrop ${selected ? "open" : ""}`}
        onClick={() => setSelectedId(null)}
        aria-hidden={!selected}
      />
      <aside
        className={`drawer ${selected ? "open" : ""}`}
        aria-hidden={!selected}
        aria-label="Job details"
      >
        {selected && (
          <>
            <div className="drawer-head">
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.id}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close details"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>
            <div className="drawer-tabs">
              <button
                type="button"
                className={drawerTab === "overview" ? "active" : ""}
                onClick={() => setDrawerTab("overview")}
              >
                Overview
              </button>
              <button
                type="button"
                className={drawerTab === "logs" ? "active" : ""}
                onClick={() => setDrawerTab("logs")}
              >
                Logs
              </button>
            </div>
            <div className="drawer-body">
              {drawerTab === "overview" ? (
                <>
                  <span className={`status ${selected.status}`}>{selected.status}</span>
                  <dl className="kv" style={{ marginTop: "1rem" }}>
                    <dt>Service</dt>
                    <dd>{selected.service}</dd>
                    <dt>Env</dt>
                    <dd>{selected.env}</dd>
                    <dt>Queue</dt>
                    <dd>{selected.queue}</dd>
                    <dt>Worker</dt>
                    <dd>{selected.worker}</dd>
                    <dt>Image</dt>
                    <dd>{selected.image}</dd>
                    <dt>CPU</dt>
                    <dd>{selected.cpuPct}%</dd>
                    <dt>Memory</dt>
                    <dd>
                      {selected.memMb} / {selected.memLimitMb} MiB
                    </dd>
                    <dt>Retries</dt>
                    <dd>{selected.retries}</dd>
                    <dt>Duration</dt>
                    <dd>{formatDuration(selected.durationSec)}</dd>
                  </dl>
                  <h3 style={{ fontSize: "0.78rem", margin: "0 0 0.45rem" }}>
                    CPU trend
                  </h3>
                  <Sparkline values={selected.sparkCpu} />
                </>
              ) : (
                <div className="logs" aria-live="polite">
                  {LOG_LINES[selected.status].map((line, i) => (
                    <div
                      key={`${selected.id}-${i}`}
                      className={line.includes("ERROR") ? "err" : ""}
                    >
                      <span className="ts">
                        {new Date(
                          now - (LOG_LINES[selected.status].length - i) * 4000,
                        )
                          .toISOString()
                          .slice(11, 19)}
                      </span>
                      {line}
                    </div>
                  ))}
                  {selected.status === "running" && (
                    <div>
                      <span className="ts">
                        {new Date(now).toISOString().slice(11, 19)}
                      </span>
                      streaming… heartbeat ok
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
