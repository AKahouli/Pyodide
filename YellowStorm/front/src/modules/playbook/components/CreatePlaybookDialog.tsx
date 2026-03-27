import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePlaybookStore } from '../store';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';
import type { GeneratePlaybookData } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  retryData?: GeneratePlaybookData | null;
}

export function CreatePlaybookDialog({ open, onOpenChange, retryData }: Props) {
  const [tab, setTab] = useState<'manual' | 'auto'>('manual');

  // Manual fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Auto builder fields
  const [autoName, setAutoName] = useState('');
  const [autoPrompt, setAutoPrompt] = useState('');
  const [autoWorkspaces, setAutoWorkspaces] = useState<string[]>([]);

  const createPlaybook = usePlaybookStore((s) => s.createPlaybook);
  const generatePlaybook = usePlaybookStore((s) => s.generatePlaybook);
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');

  // Restore auto builder fields when retrying
  useEffect(() => {
    if (retryData && open) {
      setTab('auto');
      setAutoName(retryData.name);
      setAutoPrompt(retryData.prompt);
      setAutoWorkspaces(retryData.workspaces ?? []);
    }
  }, [retryData, open]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setWorkspaces([]);
    setAutoName('');
    setAutoPrompt('');
    setAutoWorkspaces([]);
  };

  const handleCreate = async () => {
    if (!name.trim() || name.length < 2) return;
    setIsCreating(true);
    try {
      const playbook = await createPlaybook({
        name: name.trim(),
        description: description.trim(),
        workspaces: workspaces.length > 0 ? workspaces : undefined,
      });
      onOpenChange(false);
      resetForm();
      navigate(`/playbooks/${playbook.id}`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleGenerate = () => {
    if (!autoName.trim() || autoName.length < 2 || !autoPrompt.trim() || autoPrompt.length < 10) return;
    const data: GeneratePlaybookData = {
      name: autoName.trim(),
      prompt: autoPrompt.trim(),
      workspaces: autoWorkspaces.length > 0 ? autoWorkspaces : undefined,
    };
    onOpenChange(false);
    navigate('/playbooks/generating');
    generatePlaybook(data).then(() => {
      resetForm();
    }).catch((err) => {
      handleApiError(err);
      navigate('/playbooks');
    });
  };

  const handleClose = (v: boolean) => {
    if (!v) resetForm();
    onOpenChange(v);
  };

  const isManualValid = name.trim().length >= 2;
  const isAutoValid = autoName.trim().length >= 2 && autoPrompt.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'manual' | 'auto')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">{t('create.tabManual')}</TabsTrigger>
            <TabsTrigger value="auto" className="gap-1.5">
              <Wand2 className="h-3.5 w-3.5" />
              {t('create.tabAutoBuilder')}
            </TabsTrigger>
          </TabsList>

          {/* Manual creation */}
          <TabsContent value="manual" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="playbook-name">{t('create.nameLabel')}</Label>
              <Input
                id="playbook-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('create.namePlaceholder')}
                maxLength={100}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="playbook-desc">{t('create.descriptionLabel')}</Label>
              <Textarea
                id="playbook-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('create.descriptionPlaceholder')}
                maxLength={2000}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('workspace.label')}</Label>
              <PlaybookWorkspaceSelect value={workspaces} onChange={setWorkspaces} />
            </div>
          </TabsContent>

          {/* Auto builder */}
          <TabsContent value="auto" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="auto-name">{t('create.nameLabel')}</Label>
              <Input
                id="auto-name"
                value={autoName}
                onChange={(e) => setAutoName(e.target.value)}
                placeholder={t('create.namePlaceholder')}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto-prompt">{t('create.promptLabel')}</Label>
              <Textarea
                id="auto-prompt"
                value={autoPrompt}
                onChange={(e) => setAutoPrompt(e.target.value)}
                placeholder={t('create.promptPlaceholder')}
                maxLength={5000}
                rows={5}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('workspace.label')}</Label>
              <PlaybookWorkspaceSelect value={autoWorkspaces} onChange={setAutoWorkspaces} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {t('common.cancel')}
          </Button>
          {tab === 'manual' ? (
            <Button onClick={handleCreate} disabled={!isManualValid || isCreating}>
              {isCreating ? t('common.creating') : t('create.submit')}
            </Button>
          ) : (
            <Button onClick={handleGenerate} disabled={!isAutoValid}>
              <Wand2 className="h-4 w-4 mr-2" />
              {t('create.generate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
