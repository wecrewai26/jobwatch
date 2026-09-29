# JobWatch

Live **Jobs Explorer** UI inspired by [Datadog Container Monitoring / Containers Explorer](https://docs.datadoghq.com/containers/monitoring).

## Run

```bash
cd web
npm install
npm run dev
```

## UI patterns (from Datadog)

- Faceted filters (status, queue, service)
- Query bar with `status:` / `service:` tokens
- Collapsible summary graphs (timeseries + scatter)
- Group / pivot by queue, service, worker, or env
- Dense live metrics table (2s refresh)
- Row → side panel with overview + streaming-style logs
