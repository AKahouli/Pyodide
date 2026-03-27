import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, X, User, Trash2, Pencil, Check, Mail, Bot, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth';
import { useConversationStore } from '../store';
import { fetchTaggedAgents, removeConversationMember, updateConversationMemberJob } from '../api';
import type { Agent } from '@/modules/agent/types';

interface CreateGroupConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'create' | 'manage';
}

export function CreateGroupConversationDialog({ open, onOpenChange, mode = 'create' }: CreateGroupConversationDialogProps) {
  const { t } = useModuleTranslation('conversation');
  const [participants, setParticipants] = useState<{ email: string; job: string }[]>([{ email: '', job: '' }]);
  const [ownerJob, setOwnerJob] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [sharedAgents, setSharedAgents] = useState<Agent[]>([]);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [jobInput, setJobInput] = useState('');
  const createConversation = useConversationStore((s) => s.createConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const setCurrentConversation = useConversationStore((s) => s.setCurrentConversation);
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentConversation = useConversationStore((s) => s.currentConversation);

  const isManageMode = mode === 'manage';
  const isOwner = !isManageMode || (currentConversation?.groupMeta?.members?.some(m => m.userId === user?.id && m.status === 'owner'));
  const members = currentConversation?.groupMeta?.members || [];
  const invitedUsers = currentConversation?.groupMeta?.invitedUsers || [];

  useEffect(() => {
    if (open && isManageMode && currentConversation?.id) {
      fetchTaggedAgents(currentConversation.id)
        .then(setSharedAgents)
        .catch(err => console.error('Failed to fetch shared agents:', err));
    } else if (!open) {
      setSharedAgents([]);
    }
  }, [open, isManageMode, currentConversation?.id]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setParticipants([{ email: '', job: '' }]);
    }
    onOpenChange(isOpen);
  };

  const addParticipantField = () => {
    const trimmedEmails = participants.map((p) => p.email.trim().toLowerCase()).filter(Boolean);

    if (user && trimmedEmails.includes(user.email.toLowerCase())) {
      toast.error(t('newConversation.groupDialog.selfInviteError'));
      return;
    }

    const hasDuplicate = trimmedEmails.some((email, index) => trimmedEmails.indexOf(email) !== index);
    if (hasDuplicate) {
      toast.error(t('newConversation.groupDialog.duplicateEmailError'));
      return;
    }

    setParticipants((prev) => [...prev, { email: '', job: '' }]);
  };

  const updateParticipant = (index: number, field: 'email' | 'job', value: string) => {
    setParticipants((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeParticipantField = (index: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== index));
  };

  const validParticipants = participants
    .filter((p) => p.email.trim() && p.email.includes('@'));

  const trimmedEmails = participants.map((p) => p.email.trim().toLowerCase());
  const hasDuplicates = trimmedEmails.some((email, index) => email !== '' && trimmedEmails.indexOf(email) !== index);

  const handleCommit = async () => {
    const participantsToInvite = validParticipants
        .map(p => ({ email: p.email.toLowerCase(), job: p.job.trim() || undefined }))
        .filter((p, index, self) => self.findIndex(t => t.email === p.email) === index);

    const filteredParticipants = participantsToInvite.filter((p) => {
      const isMember = members.some((m) => m.email?.toLowerCase() === p.email);
      const isInvited = invitedUsers.some((i) => i.email.toLowerCase() === p.email);
      return !isMember && !isInvited;
    });

    if (filteredParticipants.length === 0 && isManageMode) {
      if (validParticipants.length > 0) {
        toast.info(t('newConversation.groupDialog.alreadyMemberOrInvited'));
      }
      handleOpenChange(false);
      return;
    }

    if (filteredParticipants.length === 0 && !isManageMode) return;

    if (filteredParticipants.some((p) => user && p.email.trim().toLowerCase() === user.email.toLowerCase())) {
      toast.error(t('newConversation.groupDialog.selfInviteError'));
      return;
    }

    setIsCreating(true);
    try {
      if (isManageMode && currentConversation) {
        // We use participants field in update as well if the store/api supports it, otherwise participantEmails
        await updateConversation(currentConversation.id, { 
            participants: filteredParticipants,
            participantEmails: filteredParticipants.map(p => p.email) 
        });
        toast.success(t('newConversation.groupDialog.invitationsSent'));
        handleOpenChange(false);
      } else {
        const conversation = await createConversation({ 
            participants: filteredParticipants,
            participantEmails: filteredParticipants.map(p => p.email),
            ownerJob: ownerJob.trim() || undefined
        });
        handleOpenChange(false);
        navigate(`/conversation/${conversation.id}`);
      }
    } catch (err: any) {
      toast.error(isManageMode ? t('newConversation.groupDialog.inviteError') : t('newConversation.groupDialog.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!currentConversation) return;
    try {
      await removeConversationMember(currentConversation.id, memberId);
      toast.success('Member removed successfully');
      await setCurrentConversation(currentConversation.id);
    } catch (err: any) {
      toast.error('Failed to remove member');
    }
  };

  const handleUpdateJob = async (memberId: string) => {
    if (!currentConversation) return;
    try {
      await updateConversationMemberJob(currentConversation.id, memberId, jobInput);
      toast.success('Role updated successfully');
      await setCurrentConversation(currentConversation.id);
    } catch (err: any) {
      toast.error('Failed to update role');
    } finally {
      setEditingJobId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md md:max-w-lg'>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            {isManageMode 
              ? (isOwner ? t('newConversation.groupDialog.manageTitle') : t('newConversation.groupDialog.membersLabel')) 
              : t('newConversation.groupDialog.title')}
          </DialogTitle>
          {(!isManageMode || isOwner) && (
            <DialogDescription>
              {isManageMode 
                ? t('newConversation.groupDialog.manageDescription') 
                : t('newConversation.groupDialog.description')}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className='space-y-6'>
          {isManageMode && (
            <div className='space-y-6'>
              <div className='space-y-3'>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">{t('newConversation.groupDialog.membersLabel')}</Label>
                  <Badge variant="secondary" className="text-xs">{members.length}</Badge>
                </div>
                <div className='max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar'>
                  {members.map((member) => {
                    const displayName = member.userId === user?.id 
                            ? t('newConversation.groupDialog.you') 
                            : (member.name || member.email?.split('@')[0] || member.userId);
                    const initials = displayName.substring(0, 2).toUpperCase();

                    return (
                    <div key={member.userId} className='flex items-center justify-between p-2.5 bg-card border rounded-lg shadow-sm transition-all hover:border-primary/20'>
                      <div className='flex items-center gap-3 flex-1 overflow-hidden'>
                        <Avatar className="h-9 w-9 border">
                           <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">{initials}</AvatarFallback>
                        </Avatar>
                        <div className='flex flex-col flex-1 truncate'>
                          <div className="flex items-center gap-2">
                            <span className='font-semibold text-sm truncate'>
                              {displayName}
                            </span>
                            {member.status === 'owner' && (
                              <Badge variant="default" className="h-4 px-1 text-[9px] uppercase tracking-wider">Owner</Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1.5 mt-0.5 min-h-[20px]">
                            {editingJobId === member.userId ? (
                              <div className="flex items-center gap-1.5">
                                <Input 
                                  value={jobInput} 
                                  onChange={(e) => setJobInput(e.target.value)} 
                                  className="h-6 text-xs w-32 px-2 py-0 focus-visible:ring-1" 
                                  placeholder="Role..." 
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleUpdateJob(member.userId);
                                    if (e.key === 'Escape') setEditingJobId(null);
                                  }}
                                />
                                <div className="flex items-center bg-muted rounded-md p-0.5">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-green-600 hover:text-green-700 hover:bg-white/50"
                                    onClick={() => handleUpdateJob(member.userId)}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-muted-foreground hover:text-foreground hover:bg-white/50"
                                    onClick={() => setEditingJobId(null)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center group/job">
                                {member.job ? (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40"></span>
                                    {member.job}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground/50 italic">No role set</span>
                                )}
                                {isOwner && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 opacity-0 group-hover/job:opacity-100 transition-opacity ml-1"
                                    onClick={() => {
                                      setEditingJobId(member.userId);
                                      setJobInput(member.job || '');
                                    }}
                                  >
                                    <Pencil className="h-3 w-3 text-muted-foreground" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {isOwner && member.userId !== user?.id && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0 ml-2 transition-colors'
                          onClick={() => handleRemoveMember(member.userId)}
                          title='Remove member'
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  )})}
                </div>
              </div>

              {invitedUsers.length > 0 && (
                <>
                  <Separator />
                  <div className='space-y-3'>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-sm font-semibold">{t('newConversation.groupDialog.statusGuest')}s / {t('newConversation.groupDialog.invitedLabel')}</Label>
                    </div>
                    <div className='max-h-32 overflow-y-auto space-y-2 pr-2 custom-scrollbar'>
                      {invitedUsers.map((invited) => (
                        <div key={invited.email} className='flex items-center justify-between p-2.5 bg-muted/20 rounded-lg border border-dashed border-border/60'>
                          <div className='flex items-center gap-3'>
                            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted border border-dashed">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground/60" />
                            </div>
                            <div className='flex flex-col'>
                              <span className='font-medium text-sm'>{invited.email}</span>
                              <div className="flex items-center gap-2">
                                <span className='text-[11px] text-muted-foreground flex items-center gap-1'>
                                  <span className={`w-1.5 h-1.5 rounded-full ${invited.status === 'Confirmed' ? 'bg-green-500' : 'bg-orange-400'}`}></span>
                                  {invited.status === 'Confirmed' ? t('newConversation.groupDialog.statusRegistered') : t('newConversation.groupDialog.statusGuest')}
                                </span>
                                {invited.job && (
                                   <Badge variant="outline" className="h-3.5 px-1 text-[9px] font-normal text-muted-foreground">{invited.job}</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {sharedAgents.length > 0 && (
                <>
                  <Separator />
                  <div className='space-y-3'>
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-sm font-semibold">{t('newConversation.groupDialog.sharedAgentsLabel')}</Label>
                    </div>
                    <div className='max-h-32 overflow-y-auto space-y-2 pr-2 custom-scrollbar'>
                      {sharedAgents.map((agent) => (
                        <div key={agent.id} className='flex items-center justify-between p-2.5 bg-card border rounded-lg shadow-sm'>
                          <div className='flex items-center gap-3'>
                            <Avatar className="h-8 w-8 border">
                               <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-medium"><Bot className="h-4 w-4"/></AvatarFallback>
                            </Avatar>
                            <div className='flex flex-col'>
                              <span className='font-medium text-sm'>{agent.name}</span>
                              <span className='text-[11px] text-muted-foreground'>{agent.agentType?.name || ''}</span>
                            </div>
                          </div>
                          <Badge variant='outline' className='text-[10px] bg-secondary/20'>Agent</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {isManageMode && isOwner && <Separator className="my-2" />}

          {isOwner && (
            <div className='space-y-4'>
              {!isManageMode && (
                <div className='space-y-2 bg-primary/5 p-3 rounded-xl border border-primary/10'>
                  <Label className="text-sm font-semibold">{t('newConversation.groupDialog.yourRoleLabel')}</Label>
                  <Input 
                    type='text' 
                    value={ownerJob} 
                    onChange={(e) => setOwnerJob(e.target.value)} 
                    placeholder={t('newConversation.groupDialog.ownerRolePlaceholder')}
                    className="shadow-sm bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground">{t('newConversation.groupDialog.ownerRoleHint')}</p>
                </div>
              )}

              <div className='space-y-3 bg-muted/10 p-3 rounded-xl border border-border/50'>
                <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">{t('newConversation.groupDialog.emailsLabel')}</Label>
                <div className="flex gap-20 pr-12">
                   <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Email</span>
                   <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Role</span>
                </div>
              </div>
              <div className="space-y-3">
                {participants.map((p, index) => {
                  const isDuplicate = p.email.trim() !== '' && trimmedEmails.indexOf(p.email.trim().toLowerCase()) !== index;
                  return (
                    <div key={index} className='flex gap-2 items-start'>
                      <div className="flex-1 space-y-1">
                        <Input 
                          type='email' 
                          value={p.email} 
                          onChange={(e) => updateParticipant(index, 'email', e.target.value)} 
                          placeholder={t('newConversation.groupDialog.emailsPlaceholder')}
                          className={`shadow-sm ${isDuplicate ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        />
                      </div>
                      <div className="w-32">
                        <Input 
                          type='text' 
                          value={p.job} 
                          onChange={(e) => updateParticipant(index, 'job', e.target.value)} 
                          placeholder="Role"
                          className="shadow-sm"
                        />
                      </div>
                      {participants.length > 1 && (
                        <Button type='button' variant='ghost' size='icon' className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeParticipantField(index)}>
                          <X className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              
              <div className="flex items-center justify-between pt-1">
                <Button type='button' variant='secondary' size='sm' onClick={addParticipantField} className='h-8 text-xs font-medium'>
                  <Plus className='h-3.5 w-3.5 mr-1.5' />
                  {t('newConversation.groupDialog.addEmail')}
                </Button>
                {hasDuplicates && (
                  <span className='text-[11px] font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded'>
                    {t('newConversation.groupDialog.duplicateEmailError')}
                  </span>
                )}
              </div>
            </div>
            </div>
          )}
        </div>

        <DialogFooter className='mt-6 border-t pt-4'>
          <Button variant='outline' type='button' onClick={() => handleOpenChange(false)}>
            {isManageMode ? t('newConversation.groupDialog.close') : t('newConversation.groupDialog.cancel')}
          </Button>
          {!isManageMode && (
             <Button type='button' onClick={handleCommit} disabled={validParticipants.length === 0 || isCreating || hasDuplicates}>
               {t('newConversation.groupDialog.create')}
             </Button>
          )}
          {isManageMode && isOwner && (
             <Button type='button' onClick={handleCommit} disabled={validParticipants.length === 0 || isCreating || hasDuplicates}>
               {t('newConversation.groupDialog.addParticipants')}
             </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
