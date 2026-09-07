/**
 * Data Controls Section
 * Privacy settings and data management
 */

import * as React from "react";
import { Loader2, Download, Trash2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/modules/auth";
import { useApiAction } from "@/lib/use-api-action";
import { showSuccess } from "@/lib/notifications";
import { useModuleTranslation } from "@/modules/localization";
import * as profileApi from "../api";

export function DataControlsSection() {
  const { logout, user, refreshUser } = useAuth();
  const [dataSharing, setDataSharing] = React.useState(false);
  const { t } = useModuleTranslation('profile');
  const { t: tCommon } = useModuleTranslation('common');

  React.useEffect(() => {
    if (user) {
      setDataSharing(!!user.consents?.dataSharing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  // Track pending value for success message
  const pendingDataSharing = React.useRef<boolean | null>(null);

  // Data sharing toggle
  const { execute: updateDataSharing, isLoading: isSaving } = useApiAction(
    profileApi.updateDataSharing,
    {
      onSuccess: () => {
        if (pendingDataSharing.current !== null) {
          showSuccess(
            pendingDataSharing.current
              ? t('dataControls.toasts.analyticsEnabled')
              : t('dataControls.toasts.analyticsDisabled')
          );
          pendingDataSharing.current = null;
          refreshUser();
        }
      },
      onError: () => {
        setDataSharing((prev) => !prev); // Revert on error
        pendingDataSharing.current = null;
      },
    }
  );

  // Export data
  const { execute: exportData, isLoading: isExporting } = useApiAction(
    profileApi.exportData,
    {
      showErrorToast: true,
      onSuccess: (blob) => {
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Yellowmind-data-${
          new Date().toISOString().split("T")[0]
        }.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showSuccess(t('dataControls.export.success'));
      },
    }
  );

  // Delete account
  const {
    execute: deleteAccount,
    isLoading: isDeleting,
    error: deleteError,
  } = useApiAction(profileApi.deleteAccount, {
    showErrorToast: false, // Show error in dialog instead
    onSuccess: () => logout(),
  });

  const handleDataSharingChange = async (checked: boolean) => {
    setDataSharing(checked);
    pendingDataSharing.current = checked;
    await updateDataSharing(checked);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t('dataControls.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('dataControls.description')}
        </p>
      </div>

      <Separator />

      {/* Data Sharing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dataControls.usage.title')}</CardTitle>
          <CardDescription>
            {t('dataControls.usage.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="data-sharing">{t('dataControls.usage.label')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('dataControls.usage.helper')}
              </p>
            </div>
            <Switch
              id="data-sharing"
              checked={dataSharing}
              onCheckedChange={handleDataSharingChange}
              disabled={isSaving}
            />
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Export Data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dataControls.export.title')}</CardTitle>
          <CardDescription>
            {t('dataControls.export.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => exportData()}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('dataControls.export.loading')}
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                {t('dataControls.export.button')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Delete Account */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {t('dataControls.danger.title')}
          </CardTitle>
          <CardDescription>
            {t('dataControls.danger.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isDeleting}>
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('dataControls.danger.loading')}
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('dataControls.danger.button')}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  {t('dataControls.danger.dialogTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>{t('dataControls.danger.dialogDescription')}</p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>{t('dataControls.danger.list.account')}</li>
                    <li>{t('dataControls.danger.list.conversations')}</li>
                    <li>{t('dataControls.danger.list.sessions')}</li>
                    <li>{t('dataControls.danger.list.data')}</li>
                  </ul>
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {deleteError.message}
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon('actionCancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteAccount()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('dataControls.danger.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
