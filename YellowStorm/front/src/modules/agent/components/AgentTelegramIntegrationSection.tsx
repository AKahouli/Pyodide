import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { showInfo, showSuccess, showWarning } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import {
  deleteAgentTelegramIntegration,
  getAgentTelegramIntegration,
  upsertAgentTelegramIntegration,
} from "../api";
import type { AgentTelegramIntegration } from "../types";

type AgentTranslate = ReturnType<typeof useModuleTranslation<"agent">>["t"];

// Telegram bot tokens look like `<bot_id>:<35+ char secret>` (e.g. 123456789:AAH...)
const TELEGRAM_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

interface AgentTelegramIntegrationSectionProps {
  agentId: string | null;
}

function formatExpiry(isoDate: string | undefined): string | undefined {
  if (!isoDate) return undefined;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleString();
}

function resolveIntegrationMessage(
  integration: AgentTelegramIntegration,
  t: AgentTranslate,
): string | null {
  switch (integration.messageKey) {
    case "webhook_success":
      if (integration.linkCode) {
        return t("createEdit.fields.telegramWebhookSuccess", {
          botUsername: integration.botUsername ?? "bot",
          linkCode: integration.linkCode,
        });
      }
      return t("createEdit.fields.telegramWebhookSuccessNoCode", {
        botUsername: integration.botUsername ?? "bot",
      });
    case "webhook_failed":
      return t("createEdit.fields.telegramWebhookFailed");
    case "disabled":
      return t("createEdit.fields.telegramDisabled");
    case "saved":
      return t("createEdit.fields.telegramSaved");
    default:
      return null;
  }
}

export function AgentTelegramIntegrationSection({
  agentId,
}: AgentTelegramIntegrationSectionProps) {
  const { t } = useModuleTranslation("agent");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [integration, setIntegration] = useState<AgentTelegramIntegration | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!agentId) {
      setIntegration(null);
      setEnabled(false);
      setBotToken("");
      setTokenError(null);
      setStatusMessage(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    getAgentTelegramIntegration(agentId)
      .then((res) => {
        if (cancelled) return;
        setIntegration(res);
        setEnabled(Boolean(res?.enabled));
        setBotToken("");
        setTokenError(null);
        setStatusMessage(res ? resolveIntegrationMessage(res, t) : null);
      })
      .catch(() => {
        if (!cancelled) setIntegration(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const hasExistingToken = Boolean(integration?.hasToken);

  const showSaveFeedback = (updated: AgentTelegramIntegration) => {
    const message = resolveIntegrationMessage(updated, t);
    setStatusMessage(message);

    if (!message) {
      showSuccess(t("createEdit.fields.telegramSaved"));
      return;
    }

    switch (updated.messageKey) {
      case "webhook_success":
        showSuccess(message);
        break;
      case "webhook_failed":
        showWarning(message, {
          description: updated.errorMessage,
        });
        break;
      case "disabled":
        showInfo(message);
        break;
      default:
        showSuccess(message);
    }
  };

  const handleSave = async () => {
    if (!agentId) return;
    setTokenError(null);

    if (enabled && !hasExistingToken && !botToken) {
      setTokenError(t("createEdit.fields.telegramBotTokenRequired"));
      return;
    }
    if (enabled && botToken && !TELEGRAM_TOKEN_PATTERN.test(botToken)) {
      setTokenError(t("createEdit.fields.telegramBotTokenInvalid"));
      return;
    }

    setSaving(true);
    try {
      const updated = await upsertAgentTelegramIntegration(agentId, {
        enabled,
        botToken: botToken || undefined,
      });
      setIntegration(updated);
      setBotToken("");
      showSaveFeedback(updated);
    } catch (err) {
      setStatusMessage(null);
      showWarning(t("createEdit.fields.telegramSaveFailed"), {
        description: err instanceof Error ? err.message : t("list.errors.unknownError"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEnabledChange = async (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    if (nextEnabled || !agentId || !integration) return;

    setSaving(true);
    try {
      const updated = await upsertAgentTelegramIntegration(agentId, { enabled: false });
      setIntegration(updated);
      setBotToken("");
      showSaveFeedback(updated);
    } catch (err) {
      setEnabled(true);
      showWarning(t("createEdit.fields.telegramSaveFailed"), {
        description: err instanceof Error ? err.message : t("list.errors.unknownError"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!agentId) return;
    setSaving(true);
    try {
      await deleteAgentTelegramIntegration(agentId);
      setIntegration(null);
      setEnabled(false);
      setBotToken("");
      setTokenError(null);
      setStatusMessage(null);
      showSuccess(t("createEdit.fields.telegramRemoved"));
    } catch (err) {
      showWarning(t("createEdit.fields.telegramRemoveFailed"), {
        description: err instanceof Error ? err.message : t("list.errors.unknownError"),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLinkCommand = async () => {
    if (!integration?.linkCode) return;
    const command = `/start ${integration.linkCode}`;
    try {
      await navigator.clipboard.writeText(command);
      showSuccess(t("createEdit.fields.telegramLinkCommandCopied"));
    } catch {
      showWarning(t("createEdit.fields.telegramSaveFailed"));
    }
  };

  const isSuccessBanner =
    integration?.messageKey === "webhook_success" || integration?.webhookRegistered;
  const isWarningBanner =
    integration?.messageKey === "webhook_failed" || integration?.status === "error";

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            {t("createEdit.fields.telegramIntegration")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("createEdit.fields.telegramIntegrationDescription")}
          </p>
        </div>
        <Switch
          data-testid="telegram-switch"
          checked={enabled}
          disabled={!agentId || saving || loading}
          onCheckedChange={(checked) => void handleEnabledChange(checked)}
        />
      </div>

      {!agentId && (
        <p className="text-xs text-muted-foreground">
          {t("createEdit.fields.telegramRequiresAgent")}
        </p>
      )}

      {statusMessage && (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            isSuccessBanner && "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100",
            isWarningBanner && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
            !isSuccessBanner && !isWarningBanner && "border-muted bg-muted/40 text-foreground",
          )}
        >
          <div className="flex items-start gap-2">
            {isSuccessBanner ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="space-y-2">
              <p>{statusMessage}</p>
              {integration?.linkCode && (
                <div className="space-y-2 rounded-md border border-current/20 bg-background/60 p-3">
                  <p className="text-xs">{t("createEdit.fields.telegramLinkInstructions")}</p>
                  <code className="block rounded bg-background px-2 py-1 text-xs font-mono">
                    {t("createEdit.fields.telegramLinkCommand", {
                      linkCode: integration.linkCode,
                    })}
                  </code>
                  {integration.linkCodeExpiresAt && (
                    <p className="text-xs opacity-80">
                      {t("createEdit.fields.telegramLinkExpires", {
                        expiresAt: formatExpiry(integration.linkCodeExpiresAt) ?? integration.linkCodeExpiresAt,
                      })}
                    </p>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={handleCopyLinkCommand}>
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    {t("createEdit.fields.telegramCopyLinkCommand")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {agentId && enabled && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="agent-telegram-bot-token">
              {t("createEdit.fields.telegramBotToken")}
            </Label>
            <Input
              id="agent-telegram-bot-token"
              type="password"
              autoComplete="off"
              placeholder={
                hasExistingToken
                  ? t("createEdit.fields.telegramBotTokenKeepPlaceholder")
                  : t("createEdit.fields.telegramBotTokenPlaceholder")
              }
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={loading || saving}
            />
            <p className="text-xs text-muted-foreground">
              {hasExistingToken
                ? t("createEdit.fields.telegramBotTokenKeepHint")
                : t("createEdit.fields.telegramBotTokenHint")}
            </p>
            {tokenError && <p className="text-xs text-destructive">{tokenError}</p>}
          </div>
        </div>
      )}

      {agentId && (enabled || integration) && (
        <div className="flex items-center justify-end gap-2 pt-1">
          {integration && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={saving || loading}
            >
              {t("createEdit.fields.telegramRemove")}
            </Button>
          )}
          {enabled && (
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("createEdit.actions.saving")}
                </>
              ) : (
                t("createEdit.fields.telegramSave")
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
