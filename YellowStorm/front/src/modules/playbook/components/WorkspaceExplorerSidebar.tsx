'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, PanelLeftClose, FolderOpen, FileText, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { ResizablePanel, OverflowTooltip } from '@/components/ui/resizable-panel';
import { useWorkspaceExplorerOpen, usePlaybookStore } from '../store';
import { getWorkspaces } from '@/modules/workspace/api';
import type { Workspace, WorkspaceDocument } from '@/modules/workspace/types';
import type { InputFile } from '../types';
import type { ArtifactKind } from '../types';
import { cn } from '@/lib/utils';
import { inferArtifactKind } from '../utils/infer-artifact-kind';

const EXPLORER_STORAGE_KEY = 'ys_workspace_explorer_state';

interface ExplorerState {
  expandedWorkspaces: string[];
  selectedItems: string[];
}

function loadExplorerState(): ExplorerState {
  try {
    const stored = localStorage.getItem(EXPLORER_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch { /* noop */ }
  return { expandedWorkspaces: [], selectedItems: [] };
}

function saveExplorerState(state: ExplorerState) {
  try {
    localStorage.setItem(EXPLORER_STORAGE_KEY, JSON.stringify(state));
  } catch { /* noop */ }
}

interface WorkspaceWithDocuments extends Workspace {
  documents: WorkspaceDocument[];
  documentsLoading: boolean;
}

interface DragPayload {
  type: 'workspace' | 'document';
  id: string;
  name: string;
  workspaceId?: string;
  artifactKind?: ArtifactKind;
  metadata?: {
    workspaceId?: string;
    documentId?: string;
    filename?: string;
    filepath?: string;
    language?: string;
    mimeType?: string;
  };
}

function DocumentRow({
  document,
  workspaceId,
  isSelected,
  onToggle,
  onDragStart,
}: {
  document: WorkspaceDocument;
  workspaceId: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onDragStart: (payload: DragPayload) => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    const artifactKind = inferArtifactKind(document.filename, document.mimeType);
    const payload = {
      type: 'document' as const,
      id: document.id,
      name: document.originalName || document.filename,
      workspaceId,
      artifactKind,
      metadata: {
        workspaceId,
        documentId: document.id,
        filename: document.filename,
        filepath: document.path,
        language: document.metadata?.language,
        mimeType: document.mimeType,
      },
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart({ type: 'document', id: document.id, name: document.originalName || document.filename, workspaceId, artifactKind });
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 py-1.5 px-3 pl-10 rounded-md cursor-grab hover:bg-muted/50 transition-colors',
        isSelected && 'bg-muted'
      )}
      draggable
      onDragStart={handleDragStart}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggle(document.id)}
        className="h-4 w-4"
        onClick={(e) => e.stopPropagation()}
      />
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <OverflowTooltip text={document.originalName || document.filename} />
    </div>
  );
}

function WorkspaceTreeNode({
  workspace,
  expandedWorkspaces,
  selectedItems,
  onToggleExpand,
  onToggleDocument,
  onWorkspaceDragStart,
}: {
  workspace: WorkspaceWithDocuments;
  expandedWorkspaces: string[];
  selectedItems: string[];
  onToggleExpand: (id: string) => void;
  onToggleDocument: (docId: string) => void;
  onWorkspaceDragStart: (payload: DragPayload) => void;
}) {
  const isExpanded = expandedWorkspaces.includes(workspace.id);
  const hasDocuments = workspace.documents.length > 0;

  const handleWorkspaceDragStart = (e: React.DragEvent) => {
    const payload = {
      type: 'workspace' as const,
      id: workspace.id,
      name: workspace.name,
      metadata: {
        workspaceId: workspace.id,
      },
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    onWorkspaceDragStart({ type: 'workspace', id: workspace.id, name: workspace.name });
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={() => onToggleExpand(workspace.id)}>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 p-0 shrink-0"
          onClick={() => onToggleExpand(workspace.id)}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        <div
          className="group flex-1 flex items-center gap-2 py-1.5 px-2 rounded-md cursor-grab hover:bg-muted/50 transition-colors"
          draggable
          onDragStart={handleWorkspaceDragStart}
        >
          <Checkbox
            checked={selectedItems.includes(workspace.id)}
            className="h-4 w-4"
            onCheckedChange={() => onToggleDocument(workspace.id)}
            onClick={(e) => e.stopPropagation()}
          />
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <OverflowTooltip text={workspace.name} />
          <span className="text-xs text-muted-foreground ml-auto">{workspace.documentCount}</span>
        </div>
      </div>
      <CollapsibleContent>
        {workspace.documentsLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="ml-2">
            {workspace.documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                document={doc}
                workspaceId={workspace.id}
                isSelected={selectedItems.includes(doc.id)}
                onToggle={onToggleDocument}
                onDragStart={() => {}}
              />
            ))}
            {!hasDocuments && (
              <div className="py-1.5 px-3 pl-10 text-sm text-muted-foreground italic">
                No documents
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function WorkspaceExplorerSidebar() {
  const isOpen = useWorkspaceExplorerOpen();
  const setOpen = usePlaybookStore((s) => s.setWorkspaceExplorerOpen);

  const [workspaces, setWorkspaces] = useState<WorkspaceWithDocuments[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  useEffect(() => {
    const state = loadExplorerState();
    setExpandedWorkspaces(state.expandedWorkspaces);
    setSelectedItems(state.selectedItems);
  }, []);

  const fetchDocuments = useCallback(async (workspaceId: string) => {
    const { getDocuments } = await import('@/modules/workspace/api');
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === workspaceId ? { ...w, documentsLoading: true } : w))
    );
    try {
      const result = await getDocuments(workspaceId, { limit: 100 });
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === workspaceId ? { ...w, documents: result.documents, documentsLoading: false } : w
        )
      );
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === workspaceId ? { ...w, documentsLoading: false } : w))
      );
    }
  }, []);

  useEffect(() => {
    saveExplorerState({ expandedWorkspaces, selectedItems });
  }, [expandedWorkspaces, selectedItems]);

  useEffect(() => {
    async function fetchWorkspaces() {
      setLoading(true);
      try {
        const result = await getWorkspaces({ limit: 50 });
        const workspacesWithDocs: WorkspaceWithDocuments[] = result.workspaces.map((w) => ({
          ...w,
          documents: [],
          documentsLoading: false,
        }));
        setWorkspaces(workspacesWithDocs);
        setLoading(false);

        const currentExpanded = loadExplorerState().expandedWorkspaces;
        for (const wid of currentExpanded) {
          if (result.workspaces.some((w) => w.id === wid)) {
            fetchDocuments(wid);
          }
        }
      } catch (err) {
        console.error('Failed to fetch workspaces:', err);
        setLoading(false);
      }
    }
    if (isOpen) {
      fetchWorkspaces();
    }
  }, [isOpen, fetchDocuments]);

  const handleToggleExpand = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const isExpanding = !prev.includes(workspaceId);
      if (isExpanding) {
        fetchDocuments(workspaceId);
        return [...prev, workspaceId];
      }
      return prev.filter((id) => id !== workspaceId);
    });
  }, [fetchDocuments]);

  const handleToggleDocument = useCallback((docId: string) => {
    setSelectedItems((prev) => {
      if (prev.includes(docId)) {
        return prev.filter((id) => id !== docId);
      }
      return [...prev, docId];
    });
  }, []);

  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return workspaces;
    const lower = search.toLowerCase();
    return workspaces
      .map((w) => {
        const workspaceMatches = w.name.toLowerCase().includes(lower);
        const matchingDocs = w.documents.filter(
          (d) =>
            (d.originalName || d.filename).toLowerCase().includes(lower)
        );
        if (workspaceMatches) {
          return { ...w, documents: matchingDocs };
        }
        if (matchingDocs.length > 0) {
          return { ...w, documents: matchingDocs };
        }
        return null;
      })
      .filter((w): w is WorkspaceWithDocuments => w !== null);
  }, [workspaces, search]);

  if (!isOpen) return null;

  return (
    <ResizablePanel
      storageKey="ys_workspace_explorer_width"
      defaultWidth={288}
      minWidth={200}
      maxWidthRatio={0.4}
      handlePosition="right"
      className="border-l bg-background"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">Workspace Explorer</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 p-0"
          onClick={() => setOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="px-3 py-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No workspaces found
            </div>
          ) : (
            filteredWorkspaces.map((workspace) => (
              <WorkspaceTreeNode
                key={workspace.id}
                workspace={workspace}
                expandedWorkspaces={expandedWorkspaces}
                selectedItems={selectedItems}
                onToggleExpand={handleToggleExpand}
                onToggleDocument={handleToggleDocument}
                onWorkspaceDragStart={() => {}}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </ResizablePanel>
  );
}