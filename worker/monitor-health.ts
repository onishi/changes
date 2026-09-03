/**
 * monitor.wagaya.org 向けの共通ヘルスチェック規格（Monitor Health Check Protocol v1）に
 * 沿ったレスポンスを返す。仕様: https://github.com/onishi/monitor/blob/main/SPEC.md#22
 *
 * - web: D1への疎通確認
 * - batch: 30分毎のsync-owner/sync-repository/summary Cron Trigger（sync_runsテーブル）
 */

interface LatestRunRow {
  status: "running" | "succeeded" | "failed";
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

interface LatestSuccessRow {
  completed_at: string;
}

export async function checkHealth(env: Env): Promise<Response> {
  const now = new Date().toISOString();

  let webStatus: "ok" | "critical" = "ok";
  let webMessage = "D1への疎通に成功";
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM repositories").first<{
      count: number;
    }>();
    if (!row) throw new Error("クエリ結果が空です");
  } catch (err) {
    webStatus = "critical";
    webMessage = `D1への疎通に失敗: ${err instanceof Error ? err.message : String(err)}`;
  }

  let batchStatus: "ok" | "warning" | "critical" = "critical";
  let batchMessage = "sync_runsの実行履歴が見つかりません";
  let lastSuccessAt: string | undefined;
  try {
    const [latest, latestSuccess] = await Promise.all([
      env.DB.prepare(
        "SELECT status, started_at, completed_at, error_message FROM sync_runs ORDER BY started_at DESC LIMIT 1",
      ).first<LatestRunRow>(),
      env.DB.prepare(
        "SELECT completed_at FROM sync_runs WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1",
      ).first<LatestSuccessRow>(),
    ]);

    if (latestSuccess?.completed_at) {
      lastSuccessAt = new Date(latestSuccess.completed_at).toISOString();
    }

    if (latest) {
      if (latest.status === "succeeded") {
        batchStatus = "ok";
        batchMessage = `直近実行は成功（${latest.completed_at ?? latest.started_at}）`;
      } else if (latest.status === "running") {
        batchStatus = "ok";
        batchMessage = `実行中（開始: ${latest.started_at}）`;
      } else {
        batchStatus = lastSuccessAt ? "warning" : "critical";
        batchMessage = `直近実行が失敗: ${latest.error_message ?? "詳細不明"}`;
      }
    }
  } catch (err) {
    batchStatus = "critical";
    batchMessage = `sync_runsの取得に失敗: ${err instanceof Error ? err.message : String(err)}`;
  }

  const statuses = [webStatus, batchStatus];
  const overall = statuses.includes("critical") ? "critical" : statuses.includes("warning") ? "warning" : "ok";

  const body = {
    protocol_version: "1.0",
    service: { id: "changes", name: "changes", environment: "production" },
    generated_at: now,
    status: overall,
    checks: [
      {
        id: "web-root",
        type: "web",
        name: "D1疎通確認",
        status: webStatus,
        message: webMessage,
        checked_at: now,
      },
      {
        id: "sync-batch",
        type: "batch",
        name: "GitHub同期ジョブ（30分毎）",
        status: batchStatus,
        message: batchMessage,
        ...(lastSuccessAt ? { last_success_at: lastSuccessAt } : {}),
        expected_interval_sec: 1800,
        checked_at: now,
      },
    ],
    alert_urls: [
      {
        label: "Cloudflare Workers ダッシュボード",
        url: "https://dash.cloudflare.com/?to=/:account/workers/services/view/changes-production",
      },
      { label: "GitHub リポジトリ", url: "https://github.com/onishi/changes" },
    ],
  };

  return Response.json(body, { status: 200 });
}
