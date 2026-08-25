import { app } from "./app";
import { assertGitHubConfig } from "./config";
import { queueMessageSchema, type QueueMessage } from "./domain";
import { enqueueStaleSummaryRefreshes, generateSummary } from "./summary";
import { isRetryableSyncError, syncOwner, syncRepository } from "./sync";

async function processQueueMessage(
  env: Env,
  message: QueueMessage,
): Promise<void> {
  if (message.type === "sync-owner") {
    await syncOwner(env);
  } else if (message.type === "sync-repository") {
    await syncRepository(env, message);
  } else {
    await generateSummary(env, message.changeRecordId);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env): Promise<void> {
    try {
      assertGitHubConfig(env);
    } catch {
      console.error(
        JSON.stringify({
          event: "scheduled_sync_skipped",
          reason: "invalid_config",
        }),
      );
      return;
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(
        now,
      ),
    ]);
    try {
      const summariesRequeued = await enqueueStaleSummaryRefreshes(env, now);
      if (summariesRequeued > 0) {
        console.log(
          JSON.stringify({
            event: "summary_refreshes_enqueued",
            count: summariesRequeued,
          }),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "summary_refreshes_enqueue_failed",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
    await env.JOBS.send(
      {
        type: "sync-owner",
        requestedAt: now,
      } satisfies QueueMessage,
      { contentType: "json" },
    );
  },
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const parsed = queueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        console.error(
          JSON.stringify({
            event: "queue_message_invalid",
            messageId: message.id,
          }),
        );
        message.ack();
        continue;
      }

      try {
        await processQueueMessage(env, parsed.data);
        message.ack();
      } catch (error) {
        const retryable =
          parsed.data.type === "generate-summary" ||
          isRetryableSyncError(error);
        console.error(
          JSON.stringify({
            event: "queue_message_failed",
            messageId: message.id,
            type: parsed.data.type,
            attempt: message.attempts,
            retryable,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
        if (retryable) {
          message.retry({
            delaySeconds: Math.min(60 * 2 ** message.attempts, 3600),
          });
        } else {
          message.ack();
        }
      }
    }
  },
} satisfies ExportedHandler<Env, unknown>;
