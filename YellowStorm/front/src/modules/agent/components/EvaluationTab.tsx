import * as React from 'react';
import { Plus, Pencil, Trash2, ChevronDown, Play, Eye, Table as TableIcon, LineChart, Loader2, Save, FileDown, X, Cpu, ArrowLeft } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { API_CONFIG, AUTH_STORAGE_KEYS } from '@/lib/api/config';
import { useModuleTranslation } from '@/modules/localization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import * as ExcelJS from 'exceljs';
import { LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

import { Dataset, Evaluation, DatasetItem, Scenario, EvaluationIteration, type LaunchEvaluationData, launchEvaluation } from '../evaluation-api';
import { useModels, useModelsStore } from '@/modules/models/store';
import { useAgentStore, useEvaluationDatasets, useEvaluationScenarios, useEvaluations, useEvaluationLoading } from '../store';
import type { Agent } from '../types';

interface EvaluationTabProps {
  readonly agent: Agent | null;
}

export function EvaluationTab({ agent }: EvaluationTabProps) {
  const { t } = useModuleTranslation('agent');

  // Store Hooks
  const datasets = useEvaluationDatasets();
  const evaluations = useEvaluations();
  const scenarios = useEvaluationScenarios();
  const isEvaluationLoading = useEvaluationLoading();
  const { 
    fetchDatasets, fetchEvaluations, fetchScenarios, 
    createDataset: storeCreateDataset, deleteDataset: storeDeleteDataset,
    createScenario: storeCreateScenario, updateScenario: storeUpdateScenario, deleteScenario: storeDeleteScenario,
    deleteEvaluation: storeDeleteEvaluation, updateEvaluation: storeUpdateEvaluation
  } = useAgentStore();

  const [activeScenario, setActiveScenario] = React.useState<Scenario | null>(null);
  const [isScenarioInlineOpen, setIsScenarioInlineOpen] = React.useState(false);
  const [scenarioForm, setScenarioForm] = React.useState<Partial<Scenario>>({ name: '', numRuns: 1, mode: 'non_strict' });
  const [isEditingScenario, setIsEditingScenario] = React.useState(false);

  // Manual dataset states
  const [manualItems, setManualItems] = React.useState<DatasetItem[]>([]);
  const [manualDatasetName, setManualDatasetName] = React.useState<string>('');

  // Data State
  const [launching, setLaunching] = React.useState(false);

  const models = useModels();
  // Form State (linked to active scenario or temporary)
  const [selectedDatasetId, setSelectedDatasetId] = React.useState<string>('');
  const [numRuns, setNumRuns] = React.useState(1);
  const [runMode, setRunMode] = React.useState<string>('non_strict');
  const [runName, setRunName] = React.useState('Default Scenario');
  const [viewMode, setViewMode] = React.useState<'table' | 'chart'>('table');
  const [judgeModel, setJudgeModel] = React.useState<string>('');
  const [threshold, setThreshold] = React.useState<number>(0.7);
  const [selectedEvalForDetail, setSelectedEvalForDetail] = React.useState<Evaluation | null>(null);
  const [selectedRunIndex, setSelectedRunIndex] = React.useState<number | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Initial Fetch
  const fetchData = React.useCallback(async () => {
    if (!agent) return;

    try {
      await Promise.all([
        fetchDatasets(), 
        fetchEvaluations(agent.id), 
        fetchScenarios(agent.id)
      ]);

      // Ensure models are fetched
      useModelsStore
        .getState()
        .fetchModels()
        .catch(() => {});
    } catch (error) {
      console.error('Failed to fetch evaluation data', error);
    }
  }, [agent, fetchDatasets, fetchEvaluations, fetchScenarios]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  React.useEffect(() => {
    if (!judgeModel && models.length > 0) {
      setJudgeModel(models[0].id);
    }
  }, [models, judgeModel]);

  const applyScenario = (sc: Scenario) => {
    setSelectedDatasetId(sc.datasetId || '');
    setNumRuns(sc.numRuns);
    setRunMode(sc.mode);
    setRunName(sc.name);
  };

  // Scenario Management
  const handleCreateScenario = () => {
    setScenarioForm({ name: '', numRuns: 1, mode: 'non_strict', agentId: agent?.id });
    setIsEditingScenario(false);
    setIsScenarioInlineOpen(true);
  };

  const handleEditScenario = (sc: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    setScenarioForm(sc);
    setIsEditingScenario(true);
    setIsScenarioInlineOpen(true);
  };

  const handleDeleteScenario = async (id: string, e: React.MouseEvent) => {
    try {
      await storeDeleteScenario(id);
      if (activeScenario?.id === id) {
        setActiveScenario(null);
      }
      toast.success('Scenario deleted');
    } catch (error) {
      toast.error('Failed to delete scenario');
    }
  };

  const handleSaveScenario = async () => {
    if (!scenarioForm.name || !agent) return;
    if (!selectedDatasetId) {
      toast.error('Veuillez sélectionner un dataset avant de sauvegarder le scénario.');
      return;
    }
    try {
      if (isEditingScenario && scenarioForm.id) {
        const updated = await storeUpdateScenario(scenarioForm.id, {
          ...scenarioForm,
          datasetId: selectedDatasetId,
        });
        if (activeScenario?.id === updated.id) {
          setActiveScenario(updated);
          applyScenario(updated);
        }
        toast.success('Scenario updated');
      } else {
        const created = await storeCreateScenario({
          ...scenarioForm,
          agentId: agent.id,
          datasetId: selectedDatasetId,
        });
        setActiveScenario(created);
        applyScenario(created);
        toast.success('Scenario created');
      }
      setIsScenarioInlineOpen(false);
    } catch (error) {
      toast.error('Failed to save scenario');
    }
  };

  // Manual Dataset Methods
  const handleAddManualRow = () => {
    setManualItems([...manualItems, { question: '', reference_answer: '' }]);
    setSelectedDatasetId(''); // Unselect saved dataset when editing manual
  };

  const handleUpdateManualRow = (index: number, field: keyof DatasetItem, value: string) => {
    setManualItems((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], [field]: value };
      }
      return next;
    });
    // Clear selected dataset if we're modifying it
    if (selectedDatasetId) setSelectedDatasetId('');
  };

  const handleRemoveManualRow = (index: number) => {
    setManualItems((prev) => prev.filter((_, i) => i !== index));
    if (selectedDatasetId) setSelectedDatasetId('');
  };

  const handleSaveManualDataset = async () => {
    if (!manualDatasetName || manualItems.length === 0) {
      toast.error('Veuillez entrer un nom et au moins une ligne.');
      return;
    }
    try {
      const created = await storeCreateDataset(manualDatasetName, manualItems);
      setSelectedDatasetId(created.id);
      setManualItems([]);
      setManualDatasetName('');
      toast.success('Dataset créé avec succès');
    } catch (error) {
      toast.error('Erreur lors de la création du dataset');
    }
  };

  const handleCancelManual = () => {
    setManualItems([]);
    setManualDatasetName('');
  };

  // File Upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const workbook = new ExcelJS.Workbook();
      const items: DatasetItem[] = [];

      if (file.name.endsWith('.xlsx')) {
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer as any);
        const worksheet = workbook.getWorksheet(1);
        worksheet?.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const question = row.getCell(1).text;
          const reference = row.getCell(2).text;
          if (question && reference) {
            items.push({ question, reference_answer: reference });
          }
        });
      } else if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const lines = text.split('\n');
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 2) {
            items.push({ question: parts[0].trim(), reference_answer: parts[1].trim() });
          }
        }
      }

      if (items.length > 0) {
        const newDs = await storeCreateDataset(file.name, items);
        setSelectedDatasetId(newDs.id);
        toast.success(`Dataset "${file.name}" imported`);
      }
    } catch (error: any) {
      toast.error('Failed to parse file: ' + error.message);
    }
  };


  /**
   * Listen for background evaluation completions via SSE
   */
  React.useEffect(() => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (!token) return;

    const url = `${API_CONFIG.baseURL}/evaluation/execute/stream?token=${token}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'completed' && data.evaluation) {
          // Update the global store with the final result
          storeUpdateEvaluation(data.evaluation_id, data.evaluation);
          
          if (selectedEvalForDetail?.id === data.evaluation_id) {
            setSelectedEvalForDetail(data.evaluation);
          }
          
          toast.success(`Evaluation "${data.evaluation.scenarioName}" completed`);
          if (agent) fetchEvaluations(agent.id); // Refresh all to be sure
        }
      } catch (err) {
        console.error('[SSE Observer] Parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('[SSE Observer] Connection error:', err);
      // EventSource auto-reconnects by default
    };

    return () => {
      eventSource.close();
    };
  }, [agent, fetchEvaluations, storeUpdateEvaluation, selectedEvalForDetail]);

  // Launch
  const handleResumeEvaluation = async (existingEval: Evaluation) => {
    if (!existingEval.datasetId) {
      toast.error("Impossible de reprendre cette ancienne évaluation. L'identifiant du dataset n'a pas été sauvegardé à l'époque. Veuillez en lancer une nouvelle.");
      return;
    }
    
    setLaunching(true);
    try {
      const result = await launchEvaluation({
        agentId: existingEval.agentId,
        datasetId: existingEval.datasetId || '',
        numRuns: existingEval.numRuns || 1,
        mode: existingEval.mode,
        scenarioName: existingEval.scenarioName,
      });

      // Update the existing entry or refresh
      fetchEvaluations(existingEval.agentId);
      toast.info('Evaluation restarted in background...');
    } catch (error: any) {
      toast.error('Failed to resume evaluation: ' + (error.message || error));
    } finally {
      setLaunching(false);
    }
  };

  const handleLaunch = async () => {
    if (!agent || !selectedDatasetId) {
      toast.error('Select a dataset first');
      return;
    }

    setLaunching(true);

    const tempId = `optimistic-${Date.now()}`;
    const optimisticEval: Evaluation = {
      id: tempId,
      agentId: agent.id,
      scenarioName: runName,
      mode: runMode as any,
      status: 'processing',
      numRuns: numRuns,
      datasetId: selectedDatasetId,
      results: [],
      createdAt: new Date().toISOString(),
    };
    
    // Add to store for immediate feedback
    useAgentStore.setState((state) => ({ evaluations: [optimisticEval, ...state.evaluations] }));

    try {
      const result = await launchEvaluation({
        agentId: agent.id,
        datasetId: selectedDatasetId,
        numRuns: numRuns,
        mode: runMode,
        scenarioName: runName,
        judgeModel: judgeModel,
        threshold: threshold,
      });

      // Update the optimistic entry with the real server-side ID
      useAgentStore.setState((state) => ({
        evaluations: state.evaluations.map((ev) => (ev.id === tempId ? result : ev))
      }));
      
      toast.info('Evaluation launched in background...');
    } catch (error: any) {
      toast.error('Failed to launch evaluation: ' + (error.message || error));
      // Rollback optimistic update
      useAgentStore.setState((state) => ({
        evaluations: state.evaluations.filter((ev) => ev.id !== tempId)
      }));
    } finally {
      setLaunching(false);
    }
  };

  const handleDeleteEval = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await storeDeleteEvaluation(id);
    } catch (error) {
      toast.error('Failed to delete evaluation');
    }
  };

  if (!agent) {
    return (
      <div className='flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-xl border-border bg-primary/5'>
        <div className='w-16 h-16 mb-4 rounded-full bg-primary/10 flex items-center justify-center'>
          <Save className='w-8 h-8 text-primary' />
        </div>
        <h3 className='text-lg font-semibold text-primary mb-2'>Save Agent First</h3>
        <p className='text-sm text-muted-foreground max-w-xs'>Save the agent config before running evaluations.</p>
      </div>
    );
  }

  const chartData = evaluations
    .filter((ev) => ev.status === 'completed' && ev.results.length > 0)
    .map((ev) => {
      const avgResp = ev.results.reduce((acc, r) => acc + r.responseMatchScore.score, 0) / ev.results.length;
      const avgFinal = ev.results.reduce((acc, r) => acc + r.finalResponseMatchV2.score, 0) / ev.results.length;
      const avgHallu = ev.results.reduce((acc, r) => acc + r.hallucinationsV1.score, 0) / ev.results.length;
      return {
        name: ev.scenarioName,
        respMatch: Math.round(avgResp * 100),
        finalMatch: Math.round(avgFinal * 100),
        hallu: Math.round(avgHallu * 100),
      };
    })
    .reverse();

  return (
    <div className='flex flex-col gap-6 py-4'>
      {/* Scenarios Management */}
      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='space-y-0.5'>
            <h3 className='text-lg font-semibold text-primary'>{t('evaluation.scenarios.title')}</h3>
            <p className='text-sm text-muted-foreground'>{t('evaluation.scenarios.subtitle')}</p>
          </div>
          {!isScenarioInlineOpen && (
            <Button type='button' onClick={handleCreateScenario} className='bg-primary hover:bg-primary/90 text-primary-foreground border-none shadow-lg'>
              <Plus className='mr-2 h-4 w-4' />
              {t('evaluation.scenarios.create')}
            </Button>
          )}
        </div>

        {isScenarioInlineOpen ? (
          <div className='space-y-2 max-w-md animate-in fade-in slide-in-from-top-1 duration-200'>
            <Label className='text-sm font-bold text-foreground'>Nom du scénario</Label>
            <div className='flex items-center'>
              <div className='relative flex-1'>
                <Input value={scenarioForm.name} onChange={(e) => setScenarioForm({ ...scenarioForm, name: e.target.value })} placeholder="Ex. Parcours d'onboarding" className='border-primary focus-visible:ring-primary h-10 pr-20 rounded-r-none' autoFocus />
                <div className='absolute right-0 top-0 h-full flex border-l border-primary'>
                  <button type='button' onClick={handleSaveScenario} className='h-full px-3 flex items-center justify-center bg-muted hover:bg-muted/70 transition-colors text-foreground'>
                    <Save className='h-4 w-4' />
                  </button>
                  <button type='button' onClick={() => setIsScenarioInlineOpen(false)} className='h-full px-3 flex items-center justify-center bg-muted hover:bg-muted/70 transition-colors text-foreground border-l border-border rounded-r-md'>
                    <X className='h-4 w-4' />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className='relative group'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className='flex items-center justify-between gap-3 px-3 py-2 border border-border rounded-md bg-muted/30 hover:bg-muted/50 transition-colors w-full max-w-sm cursor-pointer'>
                  <div className='flex-1'>
                    <p className='text-[10px] text-muted-foreground font-bold uppercase tracking-wider'>{t('evaluation.scenarios.active')}</p>
                    <p className='font-semibold text-sm text-foreground'>{activeScenario?.name || 'Sélectionner un scénario'}</p>
                  </div>
                  <ChevronDown className='h-4 w-4 text-muted-foreground' />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-[384px] p-1'>
                <DropdownMenuItem className='flex items-center gap-2 py-2 text-primary font-medium focus:text-primary cursor-pointer' onClick={handleCreateScenario}>
                  <Plus className='h-4 w-4' /> {t('evaluation.scenarios.create')}
                </DropdownMenuItem>
                {scenarios.map((sc) => (
                  <DropdownMenuItem
                    key={sc.id}
                    className='flex flex-col items-start gap-1 py-2 cursor-pointer group'
                    onClick={() => {
                      setActiveScenario(sc);
                      applyScenario(sc);
                    }}>
                    <div className='flex w-full items-center justify-between gap-2'>
                      <div className='font-semibold text-foreground'>{sc.name}</div>
                      <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6'
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditScenario(sc, e);
                          }}>
                          <Pencil className='h-3 w-3' />
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10'
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteScenario(sc.id, e);
                          }}>
                          <Trash2 className='h-3 w-3' />
                        </Button>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Accordion Sections */}
      <Accordion type='multiple' defaultValue={['dataset', 'evaluations', 'results']} className='space-y-4'>
        <AccordionItem value='dataset' className='border rounded-xl overflow-hidden bg-card shadow-sm'>
          <AccordionTrigger className='px-4 py-[0.8rem] hover:no-underline bg-background/50 border-b border-border group transition-all'>
            <div className='flex items-center gap-4 text-left'>
              <div className='flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold shrink-0'>1</div>
              <div>
                <h4 className='font-semibold text-[14px] text-foreground group-hover:text-primary transition-colors'>Dataset Q/R</h4>
                <p className='text-xs text-muted-foreground font-medium'>Préparez votre tableau question / réponse de référence.</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className='px-4 py-6 space-y-6'>
            <div className='flex items-end justify-between gap-4'>
              <div className='flex items-end gap-2 flex-1 max-w-xl'>
                <input type='file' ref={fileInputRef} className='hidden' accept='.xlsx,.csv' onChange={handleFileUpload} />
                <Button type='button' size='sm' onClick={() => fileInputRef.current?.click()}>
                  <FileDown className='mr-2 h-4 w-4' />
                  Exporter en Excel
                </Button>

                <div className='flex-1 flex flex-col gap-1'>
                  <Label htmlFor='dataset-name'>Nom du fichier</Label>
                  <Input id='dataset-name' value={manualDatasetName} onChange={(e) => setManualDatasetName(e.target.value)} placeholder='dataset_reference.xlsx' className='h-9 text-sm' />
                </div>
                {manualItems.length > 0 && (
                  <div className='flex items-end h-full px-1 gap-1'>
                    <button type='button' onClick={handleSaveManualDataset} className='w-8 h-8 rounded flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm' title='Sauvegarder'>
                      <Save className='h-4 w-4' />
                    </button>
                    <button type='button' onClick={handleCancelManual} className='w-8 h-8 rounded flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors' title='Annuler'>
                      <Trash2 className='h-4 w-4' />
                    </button>
                  </div>
                )}
              </div>

              <div className='relative w-[230px] group'>
                <label>Datasets enregistrés</label>
                <Select
                  value={selectedDatasetId}
                  onValueChange={(val) => {
                    setSelectedDatasetId(val);
                    const ds = datasets.find((d) => d.id === val);
                    if (ds && ds.items) {
                      setManualItems([...ds.items.map((item) => ({ ...item }))]);
                      toast.info(`Dataset "${ds.name}" chargé pour édition`);
                    }
                  }}>
                  <SelectTrigger className='w-full h-10'>
                    <SelectValue placeholder={datasets.length === 0 ? 'Aucun dataset disponible' : 'Sélectionner un dataset...'} />
                  </SelectTrigger>
                  <SelectContent className='bg-card border-border'>
                    {datasets.length === 0 ? (
                      <div className='py-4 px-3 text-sm text-muted-foreground'>Aucun dataset disponible</div>
                    ) : (
                      datasets.map((ds) => (
                        <SelectItem key={ds.id} value={ds.id} className='flex items-center justify-between group py-3'>
                          <div className='flex items-center justify-between w-full'>
                            <span className='text-foreground'>{ds.name}</span>
                            <Badge variant='secondary' className='ml-2'>
                              {ds.items.length} questions
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='space-y-0 relative pb-12'>
              {manualItems.length > 0 ? (
                <div className='rounded-xl overflow-hidden border border-border bg-background/60 backdrop-blur-md overflow-x-hidden shadow-2xl'>
                  <div className='flex w-full bg-muted/30 text-muted-foreground font-bold text-[11px] uppercase tracking-wider sticky top-0 z-20 shadow-lg border-b border-border'>
                    <div className='flex-1 py-[0.8rem] px-[0.8rem] text-center border-r border-border uppercase'>Question</div>
                    <div className='flex-1 py-[0.8rem] px-[0.8rem] text-center uppercase'>Réponse</div>
                    <div className='w-15'></div>
                  </div>

                  <div className='divide-y divide-primary/10 max-h-96 overflow-y-auto custom-scrollbar p-2 space-y-2'>
                    {/* Manual items */}
                    {manualItems.map((item, i) => (
                      <div key={`manual-${i}`} className='flex gap-3 items-center animate-in fade-in slide-in-from-top-2 duration-300 p-2 bg-primary/5 rounded-lg border border-border/50 group relative pr-14'>
                        <div className='flex-1 relative'>
                          <div className='bg-card border border-border rounded-lg p-3 shadow-inner group-hover:border-primary/30 transition-all'>
                            <textarea value={item?.question || ''} onChange={(e) => handleUpdateManualRow(i, 'question', e.target.value)} placeholder='Saisissez votre question ici...' className='w-full min-h-20 bg-transparent border-none outline-none text-sm resize-none focus:ring-0 placeholder:text-muted-foreground/20 text-foreground' />
                            <Pencil className='absolute top-2 right-2 h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity text-primary' />
                          </div>
                        </div>
                        <div className='flex-1 relative'>
                          <div className='bg-card border border-border rounded-lg p-3 shadow-inner group-hover:border-primary/30 transition-all'>
                            <textarea value={item?.reference_answer || ''} onChange={(e) => handleUpdateManualRow(i, 'reference_answer', e.target.value)} placeholder='Saisissez la réponse attendue...' className='w-full min-h-20 bg-transparent border-none outline-none text-sm resize-none focus:ring-0 placeholder:text-muted-foreground/20 text-foreground' />
                            <Pencil className='absolute top-2 right-2 h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity text-primary' />
                          </div>
                        </div>
                        <div className='absolute right-3 top-1/2 -translate-y-1/2'>
                          <Button type='button' variant='ghost' size='icon' className='h-10 w-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-all border-border shadow-sm' onClick={() => handleRemoveManualRow(i)}>
                            <Trash2 className='h-5 w-5' />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className='text-center py-12 flex flex-col items-center gap-4 border-2 border-dashed rounded-xl bg-muted/5 border-border/50'>
                  <p className='text-muted-foreground italic'>Préparez votre tableau question / réponse de référence.</p>
                </div>
              )}

              {/* Floating add button */}
              <div className='absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 cursor-pointer'>
                <button type='button' onClick={handleAddManualRow} className='w-7 h-7 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:scale-110 active:scale-95 transition-all flex items-center justify-center group'>
                  <Plus className='h-4 w-4 group-hover:rotate-90 transition-transform duration-300' />
                </button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value='evaluations' className='border rounded-xl overflow-hidden bg-card shadow-sm'>
          <AccordionTrigger className='px-4 py-[0.8rem] hover:no-underline bg-background/50 border-b border-border group transition-all'>
            <div className='flex items-center gap-4 text-left'>
              <div className='flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold shrink-0'>2</div>
              <div></div>
              <h4 className='font-semibold text-base text-foreground'>{t('evaluation.evaluations.title')}</h4>
              <p className='text-xs text-muted-foreground font-medium'>{t('evaluation.evaluations.description')}</p>
            </div>
          </AccordionTrigger>
          <AccordionContent className='px-4 py-6'>
            <div className='flex items-end gap-4 flex-wrap'>
              <div className='grid gap-2 min-w-75 flex-1'>
                <Label className='text-xs'>{t('evaluation.evaluations.runName')}</Label>
                <div className='relative flex items-center'>
                  <Input value={runName} onChange={(e) => setRunName(e.target.value)} className='h-9 pr-24' />
                  <div className='absolute right-1 px-2 py-1 flex items-center gap-1.5 h-7 rounded-md bg-muted/50 border border-border/50 text-[10px] font-bold text-muted-foreground pointer-events-none'>
                    <Cpu className='w-3 h-3 text-primary' />
                    <span>{models.find((m) => m.id === agent?.model)?.name || agent?.model || 'Standard'}</span>
                  </div>
                </div>
              </div>
              <div className='grid gap-2 w-24'>
                <Label className='text-xs'>{t('evaluation.evaluations.runs')}</Label>
                <Input type='number' min={1} max={10} value={numRuns} onChange={(e) => setNumRuns(Number.parseInt(e.target.value, 10))} className='h-9' />
              </div>
              <div className='grid gap-2 w-48'>
                <Label className='text-xs'>{t('evaluation.evaluations.mode')}</Label>
                <Select value={runMode} onValueChange={setRunMode}>
                  <SelectTrigger className='h-9'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='strict'>{t('evaluation.evaluations.modeStrict')}</SelectItem>
                    <SelectItem value='non_strict'>{t('evaluation.evaluations.modeNonStrict')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2 w-48'>
                <Label className='text-xs'>Modèle du juge</Label>
                <Select value={judgeModel} onValueChange={setJudgeModel}>
                  <SelectTrigger className='w-full bg-card border-primary/30'>
                    <SelectValue placeholder='Sélectionner le modèle du juge' />
                  </SelectTrigger>
                  <SelectContent className='bg-card border-border'>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Threshold Slider */}
              <div className='grid gap-2 w-48 px-1'>
                <div className='flex justify-between items-center'>
                  <Label className='text-xs'>Seuil de succès (Threshold)</Label>
                  <span className='text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded'>{threshold.toFixed(1)}</span>
                </div>
                <div className='pt-2'>
                  <Slider value={[threshold]} min={0} max={1} step={0.1} onValueChange={(vals) => setThreshold(vals[0])} className='cursor-pointer' />
                </div>
              </div>
              <Button type='button' className='bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-6 min-w-35 shadow-lg' onClick={handleLaunch} disabled={launching || !selectedDatasetId}>
                {launching ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Play className='mr-2 h-4 w-4 fill-current' />}
                {t('evaluation.evaluations.launch')}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value='results' className='border rounded-xl overflow-hidden bg-card shadow-sm'>
          <AccordionTrigger className='px-4 py-[0.8rem] hover:no-underline bg-background/50 border-b border-border group transition-all'>
            <div className='flex items-center justify-between w-full pr-4'>
              <div className='flex items-center gap-4 text-left'>
                <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground font-bold shrink-0'>3</div>
                <div>
                  <h4 className='font-bold text-lg text-foreground'>{t('evaluation.evaluations.title')}</h4>
                  <p className='text-sm text-muted-foreground font-medium'>{t('evaluation.results.description')}</p>
                </div>
              </div>
              <div className='flex items-center gap-2' onClick={(e) => e.stopPropagation()}>
                <div className='p-1 rounded-md flex gap-1 bg-muted/50'>
                  <Button type='button' variant={viewMode === 'table' ? 'secondary' : 'ghost'} size='icon' className='h-7 w-7' onClick={() => setViewMode('table')}>
                    <TableIcon className='h-4 w-4' />
                  </Button>
                  <Button type='button' variant={viewMode === 'chart' ? 'secondary' : 'ghost'} size='icon' className='h-7 w-7' onClick={() => setViewMode('chart')}>
                    <LineChart className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className='px-0 pt-0'>
            {viewMode === 'table' ? (
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead className='bg-primary/90 text-primary-foreground uppercase text-[10px] font-bold'>
                    <tr>
                      <th className='px-4 py-3 text-left tracking-wider'>RÉPONSE</th>
                      <th className='px-4 py-3 text-left tracking-wider'>Date</th>
                      <th className='px-4 py-3 text-center tracking-wider'>Resp. Match</th>
                      <th className='px-4 py-3 text-center tracking-wider'>Final Match</th>
                      <th className='px-4 py-3 text-center tracking-wider'>Hallucinations</th>
                      <th className='px-4 py-3 text-center tracking-wider'>Actions</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-muted'>
                    {evaluations.length > 0 ? (
                      evaluations.filter(Boolean).map((ev) => {
                        const totalRuns = ev.numRuns || 1;
                        
                        // Compute averages across ALL runs for the summary row
                        const avgResp = ev.results.length > 0 ? ev.results.reduce((acc, r) => acc + (r.responseMatchScore?.score || 0), 0) / ev.results.length : 0;
                        const avgFinal = ev.results.length > 0 ? ev.results.reduce((acc, r) => acc + (r.finalResponseMatchV2?.score || 0), 0) / ev.results.length : 0;
                        const avgHallu = ev.results.length > 0 ? ev.results.reduce((acc, r) => acc + (r.hallucinationsV1?.score || 0), 0) / ev.results.length : 0;
                        
                        const isFinished = ev.status === 'completed';
                        const isProcessing = ev.status === 'processing';
                        
                        return (
                          <tr key={ev.id} className='hover:bg-muted/30 transition-colors'>
                            <td className='px-4 py-3 font-medium'>
                              <div className='flex items-center gap-2'>
                                {ev.scenarioName}
                                {isProcessing && <Loader2 className='inline ml-2 h-3 w-3 animate-spin text-primary' />}
                                {totalRuns > 1 && <Badge variant='secondary' className='text-[10px] px-1.5 py-0'>{totalRuns} Runs</Badge>}
                              </div>
                            </td>
                            <td className='px-4 py-3 text-xs text-muted-foreground'>{new Date(ev.createdAt).toLocaleString()}</td>
                            <td className='px-4 py-3 text-center'>
                              <Badge variant='outline' className='text-primary border-border'>
                                {ev.results.length > 0 ? `${Math.round(avgResp * 100)}%` : '---'}
                              </Badge>
                            </td>
                            <td className='px-4 py-3 text-center'>
                              <Badge variant='outline' className='text-primary border-border'>
                                {ev.results.length > 0 ? `${Math.round(avgFinal * 100)}%` : '---'}
                              </Badge>
                            </td>
                            <td className='px-4 py-3 text-center'>
                              <Badge variant='outline' className='text-primary border-border'>
                                {ev.results.length > 0 ? `${Math.round(avgHallu * 100)}%` : '---'}
                              </Badge>
                            </td>
                            <td className='px-4 py-3 text-center'>
                              <div className='flex justify-center gap-1'>
                                <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground' onClick={() => {
                                  // Default to run 1 when opening from main table
                                  (ev as any)._selectedRunIndex = 1; 
                                  setSelectedEvalForDetail(ev);
                                }}>
                                  <Eye className='h-4 w-4' />
                                </Button>
                                <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground hover:text-destructive' onClick={(e) => handleDeleteEval(ev.id, e)}>
                                  <Trash2 className='h-4 w-4' />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6} className='px-4 py-8 text-center text-muted-foreground'>
                          No evaluations run
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className='p-6 h-75'>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width='100%' height='100%'>
                    <ReLineChart data={chartData}>
                      <CartesianGrid strokeDasharray='3 3' opacity={0.3} />
                      <XAxis dataKey='name' fontSize={10} />
                      <YAxis fontSize={10} domain={[0, 100]} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '10px' }} />
                      <Line type='monotone' dataKey='respMatch' stroke='var(--chart-1)' name='Resp Match' strokeWidth={2} dot={{ r: 4 }} />
                      <Line type='monotone' dataKey='finalMatch' stroke='var(--chart-2)' name='Final Match' strokeWidth={2} dot={{ r: 4 }} />
                      <Line type='monotone' dataKey='hallu' stroke='var(--chart-3)' name='Hallucinations' strokeWidth={2} dot={{ r: 4 }} />
                    </ReLineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className='flex items-center justify-center h-full text-muted-foreground'>Not enough data for chart</div>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Evaluation Detail Modal */}
      <Dialog 
        open={!!selectedEvalForDetail} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEvalForDetail(null);
            setSelectedRunIndex(null);
          }
        }}
      >
        <DialogContent className='max-w-6xl max-h-[90vh] overflow-hidden flex flex-col'>
          <DialogHeader className='flex-row items-center justify-start gap-4 space-y-0'>
            {selectedEvalForDetail && selectedEvalForDetail.numRuns && selectedEvalForDetail.numRuns > 1 && selectedRunIndex !== null && (
              <Button 
                variant='ghost' 
                size='icon' 
                className='h-8 w-8' 
                onClick={() => setSelectedRunIndex(null)}
              >
                <ArrowLeft className='h-4 w-4' />
              </Button>
            )}
            <div>
              <DialogTitle>
                Détails de l'évaluation: {selectedEvalForDetail?.scenarioName}
                {selectedRunIndex !== null && ` - Run #${selectedRunIndex}`}
              </DialogTitle>
              <DialogDescription>
                {selectedRunIndex === null && selectedEvalForDetail && (selectedEvalForDetail.numRuns || 1) > 1 
                  ? 'Résumé des scores par exécution.' 
                  : 'Analyse détaillée par question.'}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className='flex-1 overflow-auto mt-4 pr-1'>
            {(() => {
              if (!selectedEvalForDetail) return null;
              
              const liveEval = evaluations.find(e => e.id === selectedEvalForDetail.id);
              const results = liveEval?.results || selectedEvalForDetail.results || [];
              const isMultiRun = (selectedEvalForDetail.numRuns || 1) > 1;

              // Level 1: Multi-run summary view
              if (isMultiRun && selectedRunIndex === null) {
                // Group results by runIndex to show averages
                const runsSummary = Array.from({ length: selectedEvalForDetail.numRuns || 1 }, (_, i) => i + 1).map(runIdx => {
                  const runResults = results.filter(r => r.runIndex === runIdx);
                  const avgResp = runResults.length > 0 ? runResults.reduce((sum, r) => sum + r.responseMatchScore.score, 0) / runResults.length : 0;
                  const avgHallu = runResults.length > 0 ? runResults.reduce((sum, r) => sum + r.hallucinationsV1.score, 0) / runResults.length : 0;
                  const avgFinal = runResults.length > 0 ? runResults.reduce((sum, r) => sum + r.finalResponseMatchV2.score, 0) / runResults.length : 0;
                  
                  return {
                    runIdx,
                    count: runResults.length,
                    avgResp,
                    avgHallu,
                    avgFinal
                  };
                });

                return (
                  <Table>
                    <TableHeader>
                      <TableRow className='bg-muted/50 border-border'>
                        <TableHead className='w-20 text-[10px] font-black uppercase tracking-widest text-primary'>Run #</TableHead>
                        <TableHead className='text-center text-[10px] font-black uppercase tracking-widest text-primary'>Questions</TableHead>
                        <TableHead className='text-center text-[10px] font-black uppercase tracking-widest text-primary'>Moy. Resp Match</TableHead>
                        <TableHead className='text-center text-[10px] font-black uppercase tracking-widest text-primary'>Moy. Final Match</TableHead>
                        <TableHead className='text-center text-[10px] font-black uppercase tracking-widest text-primary'>Moy. Hallu</TableHead>
                        <TableHead className='w-20 text-right text-[10px] font-black uppercase tracking-widest text-primary'>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runsSummary.map((run) => (
                        <TableRow key={run.runIdx} className='hover:bg-primary/5 transition-colors'>
                          <TableCell className='font-bold py-4'>Run {run.runIdx}</TableCell>
                          <TableCell className='text-center font-mono py-4 text-xs'>{run.count}</TableCell>
                          <TableCell className='text-center py-4'>
                            <Badge variant='outline' className={cn('text-[10px] px-1.5 h-5 font-bold border-none', run.avgResp >= 0.7 ? 'bg-green-500/10 text-green-500' : 'bg-primary/10 text-primary')}>
                              {Math.round(run.avgResp * 100)}%
                            </Badge>
                          </TableCell>
                          <TableCell className='text-center py-4'>
                            <Badge variant='outline' className={cn('text-[10px] px-1.5 h-5 font-bold border-none', run.avgFinal >= 0.7 ? 'bg-green-500/10 text-green-500' : 'bg-primary/10 text-primary')}>
                              {Math.round(run.avgFinal * 100)}%
                            </Badge>
                          </TableCell>
                          <TableCell className='text-center py-4'>
                            <Badge variant='outline' className={cn('text-[10px] px-1.5 h-5 font-bold border-none', run.avgHallu <= 0.3 ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive')}>
                              {Math.round(run.avgHallu * 100)}%
                            </Badge>
                          </TableCell>
                          <TableCell className='text-right py-4'>
                            <Button variant='outline' size='sm' className='h-7 text-[10px] font-bold' onClick={() => setSelectedRunIndex(run.runIdx)}>
                              Détails
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              }

              // Level 2: Question details view
              const effectiveRunIdx = isMultiRun ? selectedRunIndex : 1;
              let resultsToDisplay = results.filter(r => r.runIndex === effectiveRunIdx);
              
              const seenIndices = new Set();
              resultsToDisplay = resultsToDisplay.filter(r => {
                const key = `${r.iterationIndex}`;
                if (seenIndices.has(key)) return false;
                seenIndices.add(key);
                return true;
              });

              resultsToDisplay = [...resultsToDisplay].sort((a, b) => (a.iterationIndex || 0) - (b.iterationIndex || 0));

              return (
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/50 border-border'>
                      <TableHead className='w-10 text-[10px] font-black uppercase tracking-tighter'>#</TableHead>
                      <TableHead className='min-w-50 text-[10px] font-black uppercase tracking-widest text-primary'>Question</TableHead>
                      <TableHead className='min-w-50 text-[10px] font-black uppercase tracking-widest text-primary'>Réponse Attendue</TableHead>
                      <TableHead className='min-w-50 text-[10px] font-black uppercase tracking-widest text-primary'>Réponse Obtenue</TableHead>
                      <TableHead className='w-25 text-center text-[10px] font-black uppercase tracking-widest text-primary'>Scores</TableHead>
                      <TableHead className='min-w-62.5 text-[10px] font-black uppercase tracking-widest text-primary'>Raisonnement / Détails</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultsToDisplay.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>
                          Aucun détail disponible pour cette évaluation. {liveEval?.status === 'processing' && '(En cours...)'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      resultsToDisplay.map((res) => (
                        <TableRow key={`${selectedEvalForDetail?.id}-${res.iterationIndex}`} className='group hover:bg-primary/5 transition-colors border-border/50'>
                          <TableCell className='font-mono text-[10px] py-4'>{res.iterationIndex}</TableCell>
                          <TableCell className='py-4'>
                            <div className='text-xs leading-relaxed max-w-75 whitespace-pre-wrap'>{res.question || <span className='text-muted-foreground/30 italic'>N/A</span>}</div>
                          </TableCell>
                          <TableCell className='py-4'>
                            <div className='text-xs leading-relaxed max-w-75 whitespace-pre-wrap text-muted-foreground'>{res.referenceAnswer || <span className='text-muted-foreground/30 italic'>N/A</span>}</div>
                          </TableCell>
                          <TableCell className='py-4'>
                            <div className={cn('text-xs leading-relaxed p-3 rounded-lg border max-w-75 whitespace-pre-wrap', res.status === 'failed' ? 'bg-destructive/10 border-destructive/20 text-destructive' : 'bg-card border-border/50 shadow-sm')}>{res.agentAnswer || (liveEval?.status === 'processing' ? <Loader2 className='h-3 w-3 animate-spin text-primary' /> : <span className='text-muted-foreground/30 italic'>Aucune réponse</span>)}</div>
                          </TableCell>
                          <TableCell className='py-4'>
                            <div className='flex flex-col gap-1.5 items-center'>
                              <div className='flex flex-col items-center gap-0.5'>
                                <span className='text-[8px] font-black uppercase text-muted-foreground/50'>Match</span>
                                <Badge variant='outline' className={cn('text-[10px] px-1.5 h-5 font-bold border-none', res.responseMatchScore.score >= 0.7 ? 'bg-green-500/10 text-green-500' : 'bg-primary/10 text-primary')}>
                                  {Math.round(res.responseMatchScore.score * 100)}%
                                </Badge>
                              </div>
                              <div className='flex flex-col items-center gap-0.5'>
                                <span className='text-[8px] font-black uppercase text-muted-foreground/50'>Hallu</span>
                                <Badge variant='outline' className={cn('text-[10px] px-1.5 h-5 font-bold border-none', res.hallucinationsV1.score <= 0.3 ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive')}>
                                  {Math.round(res.hallucinationsV1.score * 100)}%
                                </Badge>
                              </div>
                              <div className='flex flex-col items-center gap-0.5'>
                                <span className='text-[8px] font-black uppercase text-muted-foreground/50'>Match V2</span>
                                <Badge variant='outline' className={cn('text-[10px] px-1.5 h-5 font-bold border-none', res.finalResponseMatchV2.score >= 0.7 ? 'bg-green-500/10 text-green-500' : 'bg-primary/10 text-primary')}>
                                  {Math.round(res.finalResponseMatchV2.score * 100)}%
                                </Badge>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className='py-4 align-top'>
                            <div className='text-[11px] leading-relaxed space-y-2'>{res.responseMatchScore.reasoning || res.hallucinationsV1.reasoning ? <div className='bg-muted/30 p-3 rounded-lg border border-border/50 text-muted-foreground italic font-serif max-h-37.5 overflow-y-auto custom-scrollbar'>{res.hallucinationsV1.reasoning || res.responseMatchScore.reasoning}</div> : res.error ? <div className='bg-destructive/5 text-destructive p-2 rounded border border-destructive/10 text-[10px]'>{res.error}</div> : <span className='text-muted-foreground/20 italic'>Aucun raisonnement disponible</span>}</div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
