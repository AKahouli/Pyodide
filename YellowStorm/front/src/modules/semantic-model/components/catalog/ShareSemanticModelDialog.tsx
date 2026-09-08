import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Trash2, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { showError, showSuccess } from '@/lib/notifications';
import { searchUsers } from '@/modules/workspace/api';
import type { UserSearchResult } from '@/modules/workspace/types';
import { semanticModelApi } from '../../api';
import type { SemanticModelMember, SemanticModelShareRole } from '../../types';

interface PendingEntry {
  id: string;
  email: string;
  role: SemanticModelShareRole;
}

const ROLE_LABELS: Record<SemanticModelShareRole, string> = {
  viewer: 'Lecture seule',
  editor: 'Lecture / écriture',
};

function memberDisplayName(m: SemanticModelMember): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(' ');
  return full || m.email || m.userId;
}

function initials(m: SemanticModelMember): string {
  if (m.firstName) return m.firstName.charAt(0).toUpperCase();
  if (m.email) return m.email.charAt(0).toUpperCase();
  return '?';
}

export function ShareSemanticModelDialog({
  open,
  modelId,
  modelName,
  onOpenChange,
}: Readonly<{
  open: boolean;
  modelId: string;
  modelName: string;
  onOpenChange: (open: boolean) => void;
}>) {
  const [members, setMembers] = useState<SemanticModelMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // search state
  const [emailInput, setEmailInput] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRole, setPendingRole] = useState<SemanticModelShareRole>('viewer');
  const [pending, setPending] = useState<PendingEntry[]>([]);

  const existingEmails = useMemo(
    () => new Set([...members.map((m) => m.email ?? ''), ...pending.map((p) => p.email)].filter(Boolean)),
    [members, pending],
  );

  // Load current members
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    semanticModelApi.listShares(modelId)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [open, modelId]);

  // User search debounce
  useEffect(() => {
    const q = emailInput.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(q, 8)
        .then((results) => setSearchResults(results.filter((r) => !existingEmails.has(r.email))))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [emailInput, existingEmails]);

  const addPending = useCallback((email: string) => {
    if (!email || existingEmails.has(email)) return;
    setPending((prev) => [...prev, { id: `${Date.now()}-${email}`, email, role: pendingRole }]);
    setEmailInput('');
    setSearchResults([]);
  }, [existingEmails, pendingRole]);

  const removePending = (id: string) => setPending((prev) => prev.filter((p) => p.id !== id));

  const updatePendingRole = (id: string, role: SemanticModelShareRole) =>
    setPending((prev) => prev.map((p) => p.id === id ? { ...p, role } : p));

  const handleSend = async () => {
    if (!pending.length) return;
    setSaving(true);
    try {
      const result = await semanticModelApi.share(modelId, pending.map(({ email, role }) => ({ email, role })));
      if (result.notFound.length) showError(`Utilisateurs introuvables : ${result.notFound.join(', ')}`);
      if (result.shared.length) showSuccess(`${result.shared.length} invitation(s) envoyée(s)`);
      setPending([]);
      const updated = await semanticModelApi.listShares(modelId);
      setMembers(updated);
    } catch {
      showError('Erreur lors du partage');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRole = async (member: SemanticModelMember, role: SemanticModelShareRole) => {
    try {
      await semanticModelApi.updateShareRole(modelId, member.userId, role);
      setMembers((prev) => prev.map((m) => m.userId === member.userId ? { ...m, role } : m));
    } catch {
      showError('Impossible de modifier le rôle');
    }
  };

  const handleRevoke = async (member: SemanticModelMember) => {
    try {
      await semanticModelApi.revokeShare(modelId, member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch {
      showError("Impossible de révoquer l'accès");
    }
  };

  const close = () => { setPending([]); setEmailInput(''); setSearchResults([]); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else onOpenChange(v); }}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Users className='h-5 w-5 text-primary' />
            Partager « {modelName} »
          </DialogTitle>
          <DialogDescription>
            Invitez des collaborateurs à accéder à ce modèle sémantique.
          </DialogDescription>
        </DialogHeader>

        {/* ── Invite input ── */}
        <div className='space-y-3'>
          <Label>Inviter par email</Label>
          <div className='flex gap-2'>
            <div className='relative flex-1'>
              <Input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPending(emailInput.trim()); } }}
                placeholder="Email de l'utilisateur…"
                className='pr-8'
                autoComplete='off'
              />
              {searching && <Loader2 className='absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground' />}
              {/* Dropdown suggestions */}
              {searchResults.length > 0 && (
                <div className='absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-lg'>
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      type='button'
                      onClick={() => addPending(u.email)}
                      className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted'
                    >
                      <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary'>
                        {u.firstName ? u.firstName.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className='font-medium'>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</span>
                        {(u.firstName ?? u.lastName) && <span className='ml-1.5 text-xs text-muted-foreground'>{u.email}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select value={pendingRole} onValueChange={(v) => setPendingRole(v as SemanticModelShareRole)}>
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='viewer'>Lecture seule</SelectItem>
                <SelectItem value='editor'>Lecture / écriture</SelectItem>
              </SelectContent>
            </Select>
            <Button variant='outline' size='icon' onClick={() => addPending(emailInput.trim())} disabled={!emailInput.trim()}>
              <UserPlus className='h-4 w-4' />
            </Button>
          </div>

          {/* Pending list */}
          {pending.length > 0 && (
            <div className='space-y-1 rounded-lg border bg-muted/30 p-2'>
              {pending.map((entry) => (
                <div key={entry.id} className='flex items-center gap-2 rounded px-2 py-1'>
                  <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary'>
                    {entry.email.charAt(0).toUpperCase()}
                  </div>
                  <span className='flex-1 truncate text-sm'>{entry.email}</span>
                  <Select value={entry.role} onValueChange={(v) => updatePendingRole(entry.id, v as SemanticModelShareRole)}>
                    <SelectTrigger className='h-7 w-36 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='viewer'>Lecture seule</SelectItem>
                      <SelectItem value='editor'>Lecture / écriture</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant='ghost' size='icon' className='h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive' onClick={() => removePending(entry.id)}>
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              ))}
              <div className='flex justify-end pt-1'>
                <Button size='sm' onClick={() => void handleSend()} disabled={saving}>
                  {saving ? <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' /> : <Check className='mr-2 h-3.5 w-3.5' />}
                  Envoyer {pending.length} invitation{pending.length > 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* ── Current members ── */}
        <div className='space-y-2'>
          <Label>Accès actuels</Label>
          {loading ? (
            <div className='flex items-center justify-center py-6 text-muted-foreground'>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />Chargement…
            </div>
          ) : members.length === 0 ? (
            <p className='py-4 text-center text-sm text-muted-foreground'>Aucun collaborateur pour l'instant.</p>
          ) : (
            <div className='max-h-52 space-y-1 overflow-y-auto'>
              {members.map((member) => (
                <div key={member.userId} className='flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50'>
                  <div className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground'>
                    {initials(member)}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>{memberDisplayName(member)}</p>
                    {member.email && <p className='truncate text-xs text-muted-foreground'>{member.email}</p>}
                  </div>
                  <Badge variant='outline' className='shrink-0 text-[10px]'>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                  <Select value={member.role} onValueChange={(v) => void handleUpdateRole(member, v as SemanticModelShareRole)}>
                    <SelectTrigger className='h-7 w-36 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='viewer'>Lecture seule</SelectItem>
                      <SelectItem value='editor'>Lecture / écriture</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive'
                    onClick={() => void handleRevoke(member)}
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='flex justify-end'>
          <Button variant='outline' onClick={close}>Fermer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
