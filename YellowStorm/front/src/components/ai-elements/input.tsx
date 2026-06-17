import { PromptInput, PromptInputActionAddAttachments, PromptInputActionMenu, PromptInputActionMenuContent, PromptInputActionMenuTrigger, PromptInputAttachment, PromptInputAttachments, PromptInputBody, PromptInputButton, PromptInputFooter, type PromptInputMessage, PromptInputProvider, PromptInputSpeechButton, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from '@/components/ai-elements/prompt-input';
import { MentionPopup } from '@/components/ai-elements/mention-popup';
import { InputContextMenu } from '@/components/ai-elements/input-context-menu';
import { CreateEditAgentDialog } from '@/modules/agent/components/CreateEditAgentDialog';
import { ConnectorReposDialog } from '@/components/ai-elements/connector-repos-dialog';
import { RecentConnectorsMenu, ManageConnectorsDialog, useRecentConnectors } from '@/modules/connector';
import { RecentSkillsMenu, ManageSkillsDialog, useRecentSkills, SkillLogo } from '@/modules/skill';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';

import { Pencil, X } from 'lucide-react';
import { useRef, useState, useEffect, useCallback, useMemo, memo, type ReactNode } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SketchBoardDialog } from '@/modules/conversation/components/SketchBoard';
import { useProviderAttachments } from '@/components/ai-elements/prompt-input';
import { toast } from 'sonner';
import Usage from '../ui/usage';
import { useModels, useChefs, useModelById, useDefaultModel } from '@/modules/models';
import { useSelectedModelId, useSetSelectedModelId, useSelectedWorkspaceIds, useSetSelectedWorkspaceIds, useResetSelectedWorkspaceIds, useSetSelectedConnectorRepo, useSelectedConnectorRepo, useSelectedSkillIds, useToggleSelectedSkill } from '@/modules/conversation/store';
import { WorkspaceSelect } from '@/modules/workspace/components/WorkspaceSelect';
import { useCurrentConversation } from '@/modules/conversation/store';
import { fetchTaggedAgents } from '@/modules/conversation/api';
import { useAgents, useAgentStore } from '@/modules/agent';
import { useTeams, useTeamStore } from '@/modules/team';
import type { Agent } from '@/modules/agent/types';
import type { UserAgentFormValues } from '@/modules/agent/components/AgentFormSchema';
import { useModuleTranslation } from '@/modules/localization';
import { getActiveConnectors, getActiveSkills, type ConnectorOption } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';

const SUBMITTING_TIMEOUT = 200;
const STREAMING_TIMEOUT = 2000;

/** Lives inside PromptInputProvider so it can call attachments.add() — same path as drag/drop. */
function SketchBoardAttacher({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const attachments = useProviderAttachments();
  return (
    <SketchBoardDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={(file) => {
        attachments.add([file]);
        onOpenChange(false);
      }}
    />
  );
}

const MAX_VISIBLE_SKILL_PILLS = 3;

/** Pills of the conversation's selected skills, shown under the input box.
 *  Shows up to 3; the rest collapse into a "+N" chip revealing them on hover.
 *  Each pill has an × to deselect the skill. */
function SelectedSkillsPills({ skills, selectedIds, onRemove }: { skills: SkillOption[]; selectedIds: string[]; onRemove: (id: string) => void }) {
  const selected = useMemo(
    () => selectedIds.map((id) => skills.find((s) => s.id === id)).filter((s): s is SkillOption => Boolean(s)),
    [selectedIds, skills],
  );
  if (selected.length === 0) return null;

  const visible = selected.slice(0, MAX_VISIBLE_SKILL_PILLS);
  const overflow = selected.slice(MAX_VISIBLE_SKILL_PILLS);

  return (
    <div className='flex flex-wrap items-center gap-1.5 px-1 pt-2'>
      {visible.map((skill) => (
        <span key={skill.id} className='inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-1.5 pr-1 text-xs'>
          <SkillLogo skill={skill} size={14} />
          <span className='max-w-[140px] truncate'>{skill.name}</span>
          <button
            type='button'
            onClick={() => onRemove(skill.id)}
            className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
            aria-label={`Retirer ${skill.name}`}>
            <X className='size-3' />
          </button>
        </span>
      ))}
      {overflow.length > 0 && (
        <HoverCard openDelay={100} closeDelay={150}>
          <HoverCardTrigger asChild>
            <span className='inline-flex cursor-default items-center rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground'>
              +{overflow.length}
            </span>
          </HoverCardTrigger>
          <HoverCardContent className='w-60 p-1.5'>
            <div className='flex flex-col gap-0.5'>
              {overflow.map((skill) => (
                <div key={skill.id} className='flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted'>
                  <SkillLogo skill={skill} size={14} />
                  <span className='flex-1 truncate'>{skill.name}</span>
                  <button
                    type='button'
                    onClick={() => onRemove(skill.id)}
                    className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                    aria-label={`Retirer ${skill.name}`}>
                    <X className='size-3' />
                  </button>
                </div>
              ))}
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}

export interface FileUploadInfo {
  localId: string;
  status: 'uploading' | 'confirming' | 'completed' | 'failed';
  progress: number;
}

interface InputProps {
  onSubmit?: (message: PromptInputMessage, modelId: string, agentIds?: string[], memberIds?: string[], workspaceIds?: string[], connectorRepo?: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string }, teamIds?: string[]) => void;
  onStop?: () => void;
  status?: 'submitted' | 'streaming' | 'ready' | 'error';
  disabled?: boolean;
  submitDisabled?: boolean;
  placeholder?: string;
  onFilesAdded?: (files: File[], ids: string[]) => void;
  onFileRemoved?: (id: string) => void;
  uploadingFiles?: FileUploadInfo[];
  accept?: string;
  maxFiles?: number;
  members?: Array<{ id: string; name: string }>;
  autoMention?: { id: string; name: string; isMember?: boolean; _msgId?: string };
  showWorkspaceSelect?: boolean;
  /** Rendered inside PromptInputProvider between the textarea and the footer (e.g. suggestion chips). */
  belowTextarea?: ReactNode;
  /** Fires on each textarea input event with the current value. */
  onTextChange?: (text: string) => void;
}

const Input = memo(function Input({ onSubmit: externalSubmit, onStop, status: externalStatus, disabled, submitDisabled, placeholder, onFilesAdded, onFileRemoved, uploadingFiles, accept, maxFiles, members, autoMention, showWorkspaceSelect = true, belowTextarea, onTextChange }: InputProps = {}) {
  const models = useModels();
  const chefs = useChefs();
  const defaultModel = useDefaultModel();
  const selectedModelId = useSelectedModelId();
  const setSelectedModelId = useSetSelectedModelId();
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const setSelectedWorkspaceIds = useSetSelectedWorkspaceIds();
  const resetSelectedWorkspaceIds = useResetSelectedWorkspaceIds();
  const selectedConnectorRepo = useSelectedConnectorRepo();
  const setSelectedConnectorRepo = useSetSelectedConnectorRepo();
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [status, setStatus] = useState<'submitted' | 'streaming' | 'ready' | 'error'>('ready');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention state
  const [mentionPopupOpen, setMentionPopupOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionAnchorPos, setMentionAnchorPos] = useState({ top: 0, left: 0 });
  const [mentionMap, setMentionMap] = useState<Map<string, { id: string; type: 'agent' | 'member' | 'team' }>>(new Map());
  const [showCreateAgentDialog, setShowCreateAgentDialog] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const lastAppliedMentionMsgId = useRef<string | null>(null);
  const { t } = useModuleTranslation('common');

  const currentConversation = useCurrentConversation();
  const [sharedAgents, setSharedAgents] = useState<Agent[]>([]);

  // Fetch agents
  const agents = useAgents();
  const memoizedAgents = useMemo(() => agents, [agents]);

  // Fetch teams (mentionable as a group; expands into its agents on the backend)
  const teams = useTeams();
  const memoizedTeams = useMemo(() => teams, [teams]);

  useEffect(() => {
    useAgentStore.getState().fetchAgents();
    useTeamStore.getState().fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch shared agents for group conversations
  useEffect(() => {
    if (currentConversation?.groupMeta?.isGroup) {
      fetchTaggedAgents(currentConversation.id)
        .then((fetched) => {
          setSharedAgents(fetched || []);
        })
        .catch((err) => {
          console.error('Failed to fetch tagged agents:', err);
        });
    } else {
      setSharedAgents([]);
    }
  }, [currentConversation?.id, currentConversation?.groupMeta?.isGroup]);

  // Connectors state
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorOption | null>(null);
  const [manageConnectorsOpen, setManageConnectorsOpen] = useState(false);
  const { addRecent } = useRecentConnectors();

  // Skills state (menu + manage modal; not yet applied to the conversation)
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [manageSkillsOpen, setManageSkillsOpen] = useState(false);
  const { addRecent: addRecentSkill } = useRecentSkills();
  const selectedSkillIds = useSelectedSkillIds();
  const toggleSelectedSkill = useToggleSelectedSkill();

  // Fetch connectors
  useEffect(() => {
    setConnectorsLoading(true);
    getActiveConnectors()
      .then((data) => {
        setConnectors(data || []);
      })
      .catch((err) => {
        console.error('Failed to fetch connectors:', err);
      })
      .finally(() => {
        setConnectorsLoading(false);
      });
  }, []);

  // Fetch skills
  useEffect(() => {
    setSkillsLoading(true);
    getActiveSkills()
      .then((data) => {
        setSkills(data || []);
      })
      .catch((err) => {
        console.error('Failed to fetch skills:', err);
      })
      .finally(() => {
        setSkillsLoading(false);
      });
  }, []);

  // Use store model, or fallback to default model, or first available model
  const fallbackModelId = defaultModel?.id || models[0]?.id || '';
  const model = selectedModelId && models.some((m) => m.id === selectedModelId) ? selectedModelId : fallbackModelId;

  const selectedModelData = useModelById(model);

  // Set default model when models load and no model is selected
  useEffect(() => {
    if (models.length > 0 && !selectedModelId) {
      const modelToSelect = defaultModel?.id || models[0].id;
      setSelectedModelId(modelToSelect);
    }
  }, [models, defaultModel, selectedModelId, setSelectedModelId]);

  // Compute anchor position from textarea top edge
  const computeAnchorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    const rect = textarea.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left + 16,
    };
  }, []);

  // Handle input changes for @ detection
  const handleTextareaInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = textarea.value;
    onTextChange?.(value);
    const cursorPos = textarea.selectionStart;

    if (mentionStartIndex !== null) {
      // We're currently in a mention — update filter or close
      if (cursorPos <= mentionStartIndex) {
        // Cursor moved before @
        setMentionPopupOpen(false);
        setMentionStartIndex(null);
        setMentionFilter('');
        return;
      }

      const textAfterAt = value.slice(mentionStartIndex + 1, cursorPos);

      // Close on space or newline within the filter
      if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
        setMentionPopupOpen(false);
        setMentionStartIndex(null);
        setMentionFilter('');
        return;
      }

      setMentionFilter(textAfterAt);
      return;
    }

    // Check if character before cursor is @
    if (cursorPos > 0 && value[cursorPos - 1] === '@') {
      // Check that @ is at start or preceded by whitespace
      if (cursorPos === 1 || /\s/.test(value[cursorPos - 2])) {
        setMentionStartIndex(cursorPos - 1);
        setMentionFilter('');
        setMentionAnchorPos(computeAnchorPosition());
        setMentionPopupOpen(true);
      }
    }
  }, [mentionStartIndex, computeAnchorPosition, onTextChange]);

  // Internal helper to insert a mention
  const insertMention = useCallback(
    (item: { id: string; name: string; isMember?: boolean; isTeam?: boolean }, forcedStartIndex?: number | null) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const effectiveStartIndex = forcedStartIndex !== undefined ? forcedStartIndex : mentionStartIndex;

      const value = textarea.value;
      const cursorPos = textarea.selectionStart;

      let before, after, start;

      if (effectiveStartIndex !== null) {
        before = value.slice(0, effectiveStartIndex);
        after = value.slice(cursorPos);
        start = effectiveStartIndex;
      } else {
        // Append at cursor or end of existing text
        before = value.slice(0, cursorPos);
        // Add a space before @ if not already there and not at start
        const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
        before += prefix;
        after = value.slice(cursorPos);
        start = before.length;
      }

      const mentionText = `@${item.name} `;
      const newValue = before + mentionText + after;

      // Update textarea value via native setter to work with React controlled components
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, newValue);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Set cursor position after mention
      const newCursorPos = start + mentionText.length;
      setTimeout(() => {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);

      // Track this mention
      const mentionType = item.isTeam ? 'team' : item.isMember ? 'member' : 'agent';
      setMentionMap((prev) => new Map(prev).set(item.name, { id: item.id, type: mentionType }));

      // Close popup
      setMentionPopupOpen(false);
      setMentionStartIndex(null);
      setMentionFilter('');
    },
    [mentionStartIndex],
  );

  // Handle mention selection from popup
  const handleMentionSelect = useCallback(
    (item: { id: string; name: string; isMember?: boolean; isTeam?: boolean }) => {
      insertMention(item);
    },
    [insertMention],
  );

  // Handle auto-mention from props
  useEffect(() => {
    if (!autoMention) {
      lastAppliedMentionMsgId.current = null;
      return;
    }

    if (autoMention._msgId && autoMention._msgId !== lastAppliedMentionMsgId.current) {
      lastAppliedMentionMsgId.current = autoMention._msgId;
      // We use a small timeout to ensure the textarea is ready and hasn't been cleared/updated by other effects
      const timeoutId = setTimeout(() => {
        insertMention(
          {
            id: autoMention.id,
            name: autoMention.name,
            isMember: autoMention.isMember,
          },
          null,
        );
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [autoMention, insertMention]);

  // Intercept Enter/Escape when mention popup is open (capture phase to avoid overriding PromptInputTextarea's onKeyDown)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !mentionPopupOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMentionPopupOpen(false);
        setMentionStartIndex(null);
        setMentionFilter('');
      }
      if (e.key === 'Enter') {
        // Prevent form submit while mention popup is open
        e.preventDefault();
        e.stopPropagation();
      }
    };

    textarea.addEventListener('keydown', handleKeyDown, true);
    return () => textarea.removeEventListener('keydown', handleKeyDown, true);
  }, [mentionPopupOpen]);

  // Handle context menu "Mention agent"
  const handleContextMentionAgent = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = textarea.value;
    const cursorPos = textarea.selectionStart;
    const before = value.slice(0, cursorPos);
    const after = value.slice(cursorPos);
    const newValue = before + '@' + after;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, newValue);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const newCursorPos = cursorPos + 1;
    setTimeout(() => {
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();
      setMentionStartIndex(cursorPos);
      setMentionFilter('');
      setMentionAnchorPos(computeAnchorPosition());
      setMentionPopupOpen(true);
    }, 0);
  }, [computeAnchorPosition]);

  // Handle create agent save
  const handleCreateAgentSave = useCallback(async (data: UserAgentFormValues) => {
    setSavingAgent(true);
    try {
      await useAgentStore.getState().createAgent({
        name: data.name,
        slug: data.slug,
        agentType: data.agentType,
        role: data.role,
        description: data.description,
        temperature: data.temperature,
        model: data.model || undefined,
        instruction: data.instruction,
        ignorePrePrompt: data.ignorePrePrompt,
        knowledgeBases: data.knowledgeBases,
        tools: data.tools,
        skills: data.skills,
        disabledSkills: data.disabledSkills,
        connectors: data.connectors,
        isActive: data.isActive,
        isDefaultForType: data.isDefaultForType,
      });
      setShowCreateAgentDialog(false);
    } finally {
      setSavingAgent(false);
    }
  }, []);

  // Handle repository selection from connector dialog
  const handleRepositorySelect = useCallback((repo: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string }) => {
    setSelectedConnectorRepo(repo);
  }, [setSelectedConnectorRepo]);

  // User picked a (connected) connector to use → record it as recent and open
  // its repository picker. Covers both the recent menu and the manage modal.
  const handleSelectConnector = useCallback((connector: ConnectorOption) => {
    addRecent(connector.id);
    setSelectedConnector(connector);
    setConnectorDialogOpen(true);
  }, [addRecent]);

  // Toggle a skill for the whole conversation and record it as recent. Selected
  // skills are sent with every message (see ConversationInput / store.selectedSkillIds).
  const handleSelectSkill = useCallback((skill: SkillOption) => {
    addRecentSkill(skill.id);
    toggleSelectedSkill(skill.id);
  }, [addRecentSkill, toggleSelectedSkill]);

  const derivedStatus = externalStatus ?? status;

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      // Block submission while an answer is being generated
      if (submitDisabled || derivedStatus === 'streaming' || derivedStatus === 'submitted') {
        return;
      }

      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) {
        return;
      }

      // Extract agent and member IDs from mentions still present in the text
      // Checks both typed mentions (mentionMap) and pasted @AgentName patterns
      const agentIdSet = new Set<string>();
      const memberIdSet = new Set<string>();
      const teamIdSet = new Set<string>();

      if (message.text) {
        // Typed mentions tracked via popup selection
        for (const [name, data] of mentionMap) {
          if (message.text.includes(`@${name}`)) {
            if (data.type === 'agent') {
              agentIdSet.add(data.id);
            } else if (data.type === 'team') {
              teamIdSet.add(data.id);
            } else {
              memberIdSet.add(data.id);
            }
          }
        }
        // Pasted or untracked mentions — match against known teams (checked before
        // agents so a team name isn't mistaken for a same-named agent)
        for (const team of memoizedTeams) {
          if (!teamIdSet.has(team.id) && message.text.includes(`@${team.name}`)) {
            teamIdSet.add(team.id);
          }
        }
        // Pasted or untracked mentions — match against known agents
        for (const agent of memoizedAgents) {
          if (!agentIdSet.has(agent.id) && agent.isActive && message.text.includes(`@${agent.name}`)) {
            agentIdSet.add(agent.id);
          }
        }
        // Pasted or untracked mentions — match against group members (if any)
        if (members) {
          for (const member of members) {
            if (!memberIdSet.has(member.id) && message.text.includes(`@${member.name}`)) {
              memberIdSet.add(member.id);
            }
          }
        }
      }
      const agentIds = [...agentIdSet];
      const memberIds = [...memberIdSet];
      const teamIds = [...teamIdSet];

      if (externalSubmit) {
        externalSubmit(
          message,
          model,
          agentIds.length > 0 ? agentIds : undefined,
          memberIds.length > 0 ? memberIds : undefined,
          selectedWorkspaceIds.length > 0 ? selectedWorkspaceIds : undefined,
          selectedConnectorRepo || undefined,
          teamIds.length > 0 ? teamIds : undefined,
        );
        setMentionMap(new Map());
        resetSelectedWorkspaceIds();
        return;
      }

      setStatus('submitted');

      setTimeout(() => {
        setStatus('streaming');
      }, SUBMITTING_TIMEOUT);

      setTimeout(() => {
        setStatus('ready');
      }, STREAMING_TIMEOUT);

      setMentionMap(new Map());
    },
    [submitDisabled, derivedStatus, mentionMap, memoizedAgents, memoizedTeams, members, externalSubmit, model, selectedWorkspaceIds, resetSelectedWorkspaceIds, selectedConnectorRepo],
  );

  return (
    <div>
      <PromptInputProvider onFilesAdded={onFilesAdded} onFileRemoved={onFileRemoved} maxFiles={maxFiles} onError={(err) => toast.error(err.message)}>
        <PromptInput globalDrop multiple onSubmit={handleSubmit} accept={accept} maxFiles={maxFiles}>
          <PromptInputAttachments>
            {(attachment) => {
              const uploadInfo = uploadingFiles?.find((f) => f.localId === attachment.id);
              return <PromptInputAttachment data={attachment} uploadStatus={uploadInfo?.status} uploadProgress={uploadInfo?.progress} />;
            }}
          </PromptInputAttachments>
          <PromptInputBody>
            <InputContextMenu onMentionAgent={handleContextMentionAgent} onCreateAgent={() => setShowCreateAgentDialog(true)}>
              <PromptInputTextarea ref={textareaRef} disabled={disabled} placeholder={placeholder} onInput={handleTextareaInput} />
            </InputContextMenu>
          </PromptInputBody>
          {belowTextarea}
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                  <DropdownMenuItem onSelect={() => setSketchOpen(true)}>
                    <Pencil className='mr-2 size-4' /> {t('input.drawSketch')}
                  </DropdownMenuItem>
                  <RecentConnectorsMenu
                    connectors={connectors}
                    loading={connectorsLoading}
                    onSelectConnector={handleSelectConnector}
                    onOpenManage={() => setManageConnectorsOpen(true)}
                  />
                  <RecentSkillsMenu
                    skills={skills}
                    loading={skillsLoading}
                    selectedIds={selectedSkillIds}
                    onSelectSkill={handleSelectSkill}
                    onOpenManage={() => setManageSkillsOpen(true)}
                  />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              {showWorkspaceSelect && <WorkspaceSelect selectedIds={selectedWorkspaceIds} onChange={setSelectedWorkspaceIds} disabled={disabled || submitDisabled} />}
              {/* <PromptInputSpeechButton textareaRef={textareaRef} /> */}
              {/* <ModelSelector onOpenChange={setModelSelectorOpen} open={modelSelectorOpen}>
                <ModelSelectorTrigger asChild>
                  <PromptInputButton>
                    {selectedModelData?.chefSlug && <ModelSelectorLogo provider={selectedModelData.chefSlug} />}
                    {selectedModelData?.name && <ModelSelectorName>{selectedModelData.name}</ModelSelectorName>}
                  </PromptInputButton>
                </ModelSelectorTrigger>
                <ModelSelectorContent>
                  <ModelSelectorInput placeholder='Search models...' />
                  <ModelSelectorList>
                    <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                    {chefs.map((chef) => (
                      <ModelSelectorGroup heading={chef.name} key={chef.slug}>
                        {models
                          .filter((m) => m.chefSlug === chef.slug)
                          .map((m) => (
                            <ModelSelectorItem
                              key={m.id}
                              onSelect={() => {
                                setSelectedModelId(m.id);
                                setModelSelectorOpen(false);
                              }}
                              value={m.id}>
                              <ModelSelectorLogo provider={m.chefSlug} />
                              <ModelSelectorName>{m.name}</ModelSelectorName>
                              <ModelSelectorLogoGroup>
                                {m.providers.map((provider) => (
                                  <ModelSelectorLogo key={provider} provider={provider} />
                                ))}
                              </ModelSelectorLogoGroup>
                              {model === m.id ? <CheckIcon className='ml-auto size-4' /> : <div className='ml-auto size-4' />}
                            </ModelSelectorItem>
                          ))}
                      </ModelSelectorGroup>
                    ))}
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector> */}
            </PromptInputTools>
            <div className='flex flex-row w-fit gap-3 px-1'>
              <Usage />

              <PromptInputSubmit status={derivedStatus} disabled={disabled || submitDisabled} onStop={onStop} />
            </div>
          </PromptInputFooter>
        </PromptInput>
        <SelectedSkillsPills skills={skills} selectedIds={selectedSkillIds} onRemove={toggleSelectedSkill} />
        <SketchBoardAttacher open={sketchOpen} onOpenChange={setSketchOpen} />
      </PromptInputProvider>

      <MentionPopup
        open={mentionPopupOpen}
        onSelect={handleMentionSelect}
        onClose={() => {
          setMentionPopupOpen(false);
          setMentionStartIndex(null);
          setMentionFilter('');
        }}
        filter={mentionFilter}
        anchorPosition={mentionAnchorPos}
        agents={memoizedAgents}
        sharedAgents={sharedAgents}
        members={members}
        teams={memoizedTeams}
      />

      {showCreateAgentDialog && <CreateEditAgentDialog open={showCreateAgentDialog} onOpenChange={setShowCreateAgentDialog} agent={null} onSave={handleCreateAgentSave} saving={savingAgent} />}

      <ConnectorReposDialog
        open={connectorDialogOpen}
        onOpenChange={setConnectorDialogOpen}
        connector={selectedConnector}
        onRepositorySelect={handleRepositorySelect}
      />

      <ManageConnectorsDialog
        open={manageConnectorsOpen}
        onOpenChange={setManageConnectorsOpen}
        connectors={connectors}
        loading={connectorsLoading}
        onUseConnector={handleSelectConnector}
      />

      <ManageSkillsDialog
        open={manageSkillsOpen}
        onOpenChange={setManageSkillsOpen}
        skills={skills}
        loading={skillsLoading}
        selectedIds={selectedSkillIds}
        onToggleSkill={handleSelectSkill}
      />
    </div>
  );
});

Input.displayName = 'Input';

export type { InputProps };
export default Input;
