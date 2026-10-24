# Background processing concurrency

The shared coordinator keeps one database leader. Job claims remain durable and
conditional; concurrency changes do not add independent consumers or bypass
task deduplication, retries, priorities, or graceful shutdown.

- `RUNTIME_VISION_CONCURRENCY`: remote vision slots, default 1, maximum 8.
- `PUBLIC_DOWNLOAD_CONCURRENCY`: derivative slots, default 1, maximum 2.
- `RUNTIME_MAX_ACTIVE`: global background slots, default 6. Lanes are served in
  round-robin order; priority order remains unchanged inside each lane.
- Face clustering, similarity encoding, video processing and rendering retain
  one coordinator slot per lane. Do not parallelize face identity writes merely
  to increase throughput.
- Completed work immediately offers its slot to queued work. The periodic poll
  still discovers jobs committed by another API or a transaction.
- Waiting foreground database queries pause additional dispatch. Memory and
  event-loop pressure also pause new claims, with hysteresis on recovery.
  In-flight jobs finish normally and paused tasks stay queued in MySQL.
- `RUNTIME_MEMORY_HIGH_MB` defaults to 3072 MiB, capped at 75% of the cgroup
  memory limit. `RUNTIME_HOST_RESERVE_MB` defaults to 1024 MiB of Linux
  MemAvailable. The guard samples once per second and logs transitions only.
  macOS does not mistake unreclaimable/free-memory counters for Linux pressure.
- Derivatives decode, orient, flatten and convert the source once. Encoding
  starts at the maximum quality and only searches lower qualities if needed.
  Pixel dimensions, sRGB conversion, metadata removal and the 5,000,000-byte
  download budget are unchanged.

Tests cover bounded concurrency, priority ordering, immediate refill, foreground
DB pressure, serial face work, shutdown draining, pressure recovery and avoiding
repeated source decoding. Real-database integration also exercises leader
failover and interrupted job recovery. Deployment-specific comparisons and
private load-test artifacts belong in `.local/`, not this audit note.
