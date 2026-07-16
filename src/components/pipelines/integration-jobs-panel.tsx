"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, Check, Loader2, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface JobRow {
  id: string;
  deal_id: string | null;
  job_type: string;
  status: string;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export function IntegrationJobsPanel() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/integration-jobs", { cache: "no-store" });
      if (response.ok) setJobs(((await response.json()) as { jobs: JobRow[] }).jobs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function decide(jobId: string, approved: boolean) {
    setActing(jobId);
    await fetch(`/api/integration-jobs/${jobId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    await load();
    setActing(null);
  }

  const active = jobs.filter((job) =>
    ["pending", "leased", "running", "awaiting_approval", "retryable_error"].includes(job.status),
  );
  const failures = jobs.filter((job) => job.status === "permanent_error").slice(0, 3);
  if (!loading && active.length === 0 && failures.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="h-4 w-4 text-primary" /> OpenClaw · Dropi
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {loading ? (
        <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="mt-3 space-y-2">
          {[...active, ...failures].map((job) => (
            <div key={job.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
              {job.status === "permanent_error" && <AlertTriangle className="h-4 w-4 text-red-500" />}
              <span className="font-medium">{job.job_type.replaceAll("_", " ")}</span>
              <Badge variant="outline">{job.status}</Badge>
              <span className="text-muted-foreground">Intento {job.attempt_count}</span>
              {job.error_code && <span className="text-red-500">{job.error_code}</span>}
              {job.status === "awaiting_approval" && (
                <div className="ml-auto flex gap-1">
                  <Button size="sm" onClick={() => void decide(job.id, true)} disabled={acting === job.id}>
                    <Check className="mr-1 h-3 w-3" /> Aprobar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void decide(job.id, false)} disabled={acting === job.id}>
                    <X className="mr-1 h-3 w-3" /> Rechazar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
