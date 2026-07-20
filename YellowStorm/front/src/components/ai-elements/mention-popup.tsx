import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Agent } from '@/modules/agent/types';
import { useModuleTranslation } from '@/modules/localization';

interface MentionPopupProps {
  open: boolean;
  onSelect: (item: { id: string; name: string; isMember?: boolean; isTeam?: boolean }) => void;
  onClose: () => void;
  filter: string;
  anchorPosition: { top: number; left: number };
  agents: MentionAgent[];
  sharedAgents?: MentionAgent[];
  members?: Array<{ id: string; name: string }>;
  teams?: Array<{ id: string; name: string; agentCount?: number }>;
}

export type MentionAgent = Pick<Agent, 'id' | 'name' | 'isActive' | 'isDefault'> & { agentType?: { name?: string } };

export function MentionPopup({ open, onSelect, onClose, filter, anchorPosition, agents, sharedAgents, members, teams }: MentionPopupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [adjustedPos, setAdjustedPos] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const { t: tCommon } = useModuleTranslation('common');

  const normalizedFilter = filter.trim().toLowerCase();

  const personalAgents = useMemo(() => agents.filter((a) => !a.isDefault && a.isActive), [agents]);
  const defaultAgents = useMemo(() => agents.filter((a) => a.isDefault && a.isActive), [agents]);

  const filteredSharedAgents = useMemo(() => (sharedAgents || []).filter((agent) => agent.name.toLowerCase().includes(normalizedFilter)), [sharedAgents, normalizedFilter]);
  const filteredPersonalAgents = useMemo(() => personalAgents.filter((agent) => agent.name.toLowerCase().includes(normalizedFilter)), [personalAgents, normalizedFilter]);
  const filteredDefaultAgents = useMemo(() => defaultAgents.filter((agent) => agent.name.toLowerCase().includes(normalizedFilter)), [defaultAgents, normalizedFilter]);
  const filteredMembers = useMemo(() => (members || []).filter((m) => m.name.toLowerCase().includes(normalizedFilter)), [members, normalizedFilter]);
  const filteredTeams = useMemo(() => (teams || []).filter((tm) => tm.name.toLowerCase().includes(normalizedFilter)), [teams, normalizedFilter]);

  const combinedItems = useMemo(() => {
    return [
      ...filteredTeams.map((tm) => ({ ...tm, isTeam: true })),
      ...filteredMembers.map((m) => ({ ...m, isMember: true })),
      ...filteredSharedAgents,
      ...filteredPersonalAgents,
      ...filteredDefaultAgents,
    ] as Array<{ id: string; name: string; isMember?: boolean; isTeam?: boolean; agentCount?: number; agentType?: { name?: string } }>;
  }, [filteredTeams, filteredMembers, filteredSharedAgents, filteredPersonalAgents, filteredDefaultAgents]);

  // Adjust position after render to avoid going off-screen
  useEffect(() => {
    if (!open || !containerRef.current) return;

    const el = containerRef.current;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let left = anchorPosition.left;
    // Prevent horizontal overflow
    if (left + rect.width > viewportWidth - 8) {
      left = viewportWidth - rect.width - 8;
    }
    if (left < 8) left = 8;

    // If popup would go below viewport, position it above the anchor instead
    const spaceBelow = viewportHeight - anchorPosition.top;
    const spaceAbove = anchorPosition.top;

    if (spaceBelow < rect.height + 8 && spaceAbove > rect.height + 8) {
      // Position above: anchor top is the bottom of the textarea, so popup bottom = viewport - anchorTop
      setAdjustedPos({ bottom: viewportHeight - anchorPosition.top + 8, left });
    } else {
      // Position below (or best effort)
      const top = Math.max(8, Math.min(anchorPosition.top, viewportHeight - rect.height - 8));
      setAdjustedPos({ top, left });
    }
  }, [open, anchorPosition]);

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }

    setHighlightedIndex(combinedItems.length > 0 ? 0 : -1);
  }, [open, normalizedFilter, combinedItems.length]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (!combinedItems.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((prev) => {
          if (prev < 0) return 0;
          return prev + 1 >= combinedItems.length ? 0 : prev + 1;
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((prev) => {
          if (prev <= 0) return combinedItems.length - 1;
          return prev - 1;
        });
        return;
      }

      if (e.key === 'Enter' && highlightedIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const selected = combinedItems[highlightedIndex];
        if (selected) {
          onSelect(selected);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, combinedItems, highlightedIndex, onClose, onSelect]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const activeItem = combinedItems[highlightedIndex];
    if (!activeItem) return;
    const item = itemRefs.current.get(activeItem.id);
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedIndex, combinedItems]);

  if (!open) return null;

  return createPortal(
    <div
      ref={containerRef}
      className='fixed z-[9999] w-64 rounded-md border bg-popover text-popover-foreground shadow-lg'
      style={{
        top: adjustedPos.top,
        bottom: adjustedPos.bottom,
        left: adjustedPos.left,
      }}>
      <Command shouldFilter={false}>
        <CommandInput placeholder={tCommon('mention.searchPlaceholder')} value={filter} className='h-8 text-sm' readOnly />
        <CommandList className='max-h-48'>
          {combinedItems.length === 0 && <div className='py-6 text-center text-sm text-muted-foreground'>{tCommon('mention.empty')}</div>}

          {filteredTeams.length > 0 && (
            <CommandGroup heading={tCommon('mention.teamsHeading' as any) || 'Teams'}>
              {filteredTeams.map((team, idx) => {
                const globalIndex = idx;
                const isHighlighted = highlightedIndex === globalIndex;
                return (
                  <CommandItem
                    key={team.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(team.id, el);
                      else itemRefs.current.delete(team.id);
                    }}
                    value={team.name}
                    onMouseEnter={() => setHighlightedIndex(globalIndex)}
                    onSelect={() => onSelect({ id: team.id, name: team.name, isTeam: true })}
                    className={cn('flex items-center gap-2 cursor-pointer data-[selected=true]:bg-transparent data-[selected=true]:text-inherit', isHighlighted && '!bg-accent !text-accent-foreground')}
                  >
                    <span className='truncate'>{team.name}</span>
                    {typeof team.agentCount === 'number' && (
                      <Badge variant='secondary' className='text-[10px] px-1 py-0 ml-auto shrink-0'>
                        {team.agentCount}
                      </Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {filteredMembers.length > 0 && (
            <CommandGroup heading={tCommon('mention.membersHeading' as any) || 'Membres'}>
              {filteredMembers.map((member, idx) => {
                const globalIndex = filteredTeams.length + idx;
                const isHighlighted = highlightedIndex === globalIndex;
                return (
                  <CommandItem
                    key={member.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(member.id, el);
                      else itemRefs.current.delete(member.id);
                    }}
                    value={member.name}
                    onMouseEnter={() => setHighlightedIndex(globalIndex)}
                    onSelect={() => onSelect({ ...member, isMember: true })}
                    className={cn('flex items-center gap-2 cursor-pointer data-[selected=true]:bg-transparent data-[selected=true]:text-inherit', isHighlighted && '!bg-accent !text-accent-foreground')}
                  >
                    <span className='truncate'>{member.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {filteredSharedAgents.length > 0 && (
            <CommandGroup heading={tCommon('mention.sharedHeading')}>
              {filteredSharedAgents.map((agent, idx) => {
                const globalIndex = filteredTeams.length + filteredMembers.length + idx;
                const isHighlighted = highlightedIndex === globalIndex;
                return (
                  <CommandItem
                    key={agent.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(agent.id, el);
                      else itemRefs.current.delete(agent.id);
                    }}
                    value={agent.name}
                    onMouseEnter={() => setHighlightedIndex(globalIndex)}
                    onSelect={() => onSelect(agent)}
                    className={cn('flex items-center gap-2 cursor-pointer data-[selected=true]:bg-transparent data-[selected=true]:text-inherit', isHighlighted && '!bg-accent !text-accent-foreground')}
                  >
                    <span className='truncate'>{agent.name}</span>
                    <Badge variant='secondary' className='text-[10px] px-1 py-0 ml-auto shrink-0'>
                      {agent.agentType?.name || ''}
                    </Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {[filteredPersonalAgents, filteredDefaultAgents].map((group, groupIndex) => {
            if (!group.length) return null;
            const heading = groupIndex === 0 ? tCommon('mention.personalHeading') : tCommon('mention.defaultHeading');
            const offset = filteredTeams.length + filteredMembers.length + filteredSharedAgents.length + (groupIndex === 0 ? 0 : filteredPersonalAgents.length);
            return (
              <CommandGroup heading={heading} key={heading}>
                {group.map((agent, idx) => {
                  const globalIndex = offset + idx;
                  const isHighlighted = highlightedIndex === globalIndex;
                  return (
                    <CommandItem
                      key={agent.id}
                      ref={(el) => {
                        if (el) {
                          itemRefs.current.set(agent.id, el);
                        } else {
                          itemRefs.current.delete(agent.id);
                        }
                      }}
                      value={agent.name}
                      onMouseEnter={() => setHighlightedIndex(globalIndex)}
                      onSelect={() => onSelect(agent)}
                      className={cn('flex items-center gap-2 cursor-pointer data-[selected=true]:bg-transparent data-[selected=true]:text-inherit', isHighlighted && '!bg-accent !text-accent-foreground')}>
                      <span className='truncate'>{agent.name}</span>
                      <Badge variant='secondary' className='text-[10px] px-1 py-0 ml-auto shrink-0'>
                        {agent.agentType?.name || ''}
                      </Badge>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </div>,
    document.body,
  );
}
