import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { validateUrl } from '../api';
import { useWorkspaceStore } from '../store';

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AddLinkDialog({
  open,
  onOpenChange,
  workspaceId,
  initialUrl = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialUrl?: string;
}) {
  const addPageLink = useWorkspaceStore((s) => s.addPageLink);
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open, initialUrl]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setError(null);
    if (!isValidUrl(url)) {
      setError('Veuillez saisir une URL valide (http:// ou https://).');
      return;
    }
    const clean = url.trim();
    setIsSubmitting(true);
    try {
      const result = await validateUrl(workspaceId, clean);
      if (!result.reachable) {
        setError('Ce site est injoignable. Vérifiez le lien et réessayez.');
        setIsSubmitting(false);
        return;
      }
      await addPageLink(workspaceId, clean);
      toast.success('Lien ajouté · conversion en cours');
      onOpenChange(false);
    } catch {
      setError('Une erreur est survenue. Réessayez.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un lien</DialogTitle>
          <DialogDescription>
            Indexez le contenu d'un site web. La page sera convertie en PDF puis indexée.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='workspace-link-url'>Lien du site web</Label>
          <Input
            id='workspace-link-url'
            placeholder='https://exemple.com/page'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            autoFocus
            disabled={isSubmitting}
          />
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className='gap-1.5'>
            {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
