import * as React from 'react';
import { Plus, Pencil, Trash2, ChevronDown, Play, Eye, Table as TableIcon, LineChart, Loader2, Save, FileDown, X, Cpu } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { API_CONFIG } from '@/lib/api/config';
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

import { getDatasets, createDataset, getAgentEvaluations, deleteEvaluation, getScenarios, createScenario, updateScenario, deleteScenario, executeEvaluation, Dataset, Evaluation, DatasetItem, Scenario, EvaluationIteration, type LaunchEvaluationData } from '../evaluation-api';
import { useModels, useModelsStore } from '@/modules/models/store';
import type { Agent } from '../types';

interface EvaluationTabProps {
  readonly agent: Agent | null;
}

export function EvaluationTab({ agent }: EvaluationTabProps) {
  const { t } = useModuleTranslation('agent');

  // Scenarios State
  const [scenarios, setScenarios] = React.useState<Scenario[]>([]);
  const [activeScenario, setActiveScenario] = React.useState<Scenario | null>(null);
  const [isScenarioInlineOpen, setIsScenarioInlineOpen] = React.useState(false);
  const [scenarioForm, setScenarioForm] = React.useState<Partial<Scenario>>({ name: '', numRuns: 1, mode: 'non_strict' });
  const [isEditingScenario, setIsEditingScenario] = React.useState(false);

  // Manual dataset states
  const [manualItems, setManualItems] = React.useState<DatasetItem[]>([]);
  const [manualDatasetName, setManualDatasetName] = React.useState<string>('');

  // Data State
  const [datasets, setDatasets] = React.useState<Dataset[]>([]);
  const [evaluations, setEvaluations] = React.useState<Evaluation[]>([]);
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

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Initial Fetch
  const fetchData = React.useCallback(async () => {
    if (!agent) return;

    try {
      const [ds, ev, scs] = await Promise.all([getDatasets(), getAgentEvaluations(agent.id), getScenarios(agent.id)]);
      setDatasets(ds);
      setEvaluations(ev);
      setScenarios(scs);

      // Remove automatic scenario application on load to respect user choice
      // and show "Choisir un dataset" by default.
      if (scs.length > 0 && !launching && ev.length > 0 && !activeScenario) {
        // We keep the first one as active internally, but don't apply it to the form
        const first = scs[0];
        setActiveScenario(first);
      }

      // Auto-resume if an evaluation is processing
      const processingEval = ev.find((e) => e.status === 'processing');
      if (processingEval && !launching) {
        handleResumeEvaluation(processingEval);
      }

      // Ensure models are fetched
      useModelsStore
        .getState()
        .fetchModels()
        .catch(() => {});
    } catch (error) {
      console.error('Failed to fetch evaluation data', error);
    }
  }, [agent]);

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
    e.stopPropagation();
    try {
      await deleteScenario(id);
      setScenarios((prev) => prev.filter((s) => s.id !== id));
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
        const updated = await updateScenario(scenarioForm.id, {
          ...scenarioForm,
          datasetId: selectedDatasetId,
        });
        setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        if (activeScenario?.id === updated.id) {
          setActiveScenario(updated);
          applyScenario(updated);
        }
        toast.success('Scenario updated');
      } else {
        const created = await createScenario({
          ...scenarioForm,
          agentId: agent.id,
          datasetId: selectedDatasetId,
        });
        setScenarios((prev) => [...prev, created]);
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
      const created = await createDataset(manualDatasetName, manualItems);
      setDatasets((prev) => [...prev, created]);
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
        const newDs = await createDataset(file.name, items);
        setDatasets((prev) => [...prev, newDs]);
        setSelectedDatasetId(newDs.id);
        toast.success(`Dataset "${file.name}" imported`);
      }
    } catch (error: any) {
      toast.error('Failed to parse file: ' + error.message);
    }
  };

  // SSE streaming function for evaluation
  const executeEvaluationStream = async (data: LaunchEvaluationData, onProgress: (testCase: any) => void, onComplete: (final: any) => void, onError: (error: string) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem('yellostorm_access_token');
      if (!token) {
        onError('No authentication token');
        reject(new Error('No authentication token'));
        return;
      }

      const url = `${API_CONFIG.baseURL}/evaluation/execute/stream?token=${encodeURIComponent(token)}`;
      const eventSource = new EventSource(url);

      // Send the evaluation data as a POST request first to initiate the evaluation
      apiClient
        .post('/evaluation/execute/stream', data, { timeout: 300000 })
        .then(() => {
          // EventSource will handle the streaming updates
        })
        .catch((error) => {
          onError(error.message || 'Failed to launch evaluation');
          eventSource.close();
          reject(error);
        });

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const { type, data: eventData } = parsed;

          switch (type) {
            case 'evaluation_progress':
              onProgress(eventData);
              break;
            case 'evaluation_complete':
              onComplete(eventData);
              eventSource.close();
              resolve();
              break;
            case 'evaluation_error':
              onError(eventData.error || 'Evaluation failed');
              eventSource.close();
              reject(new Error(eventData.error || 'Evaluation failed'));
              break;
          }
        } catch (error) {
          console.error('[EvaluationStream] Failed to parse event:', error);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        onError('Connection error');
        reject(new Error('Connection error'));
      };
    });
  };

  // Launch
  const handleResumeEvaluation = async (existingEval: Evaluation) => {
    setLaunching(true);
    try {
      await executeEvaluationStream(
        {
          agentId: existingEval.agentId,
          datasetId: '', // Not strictly needed for resume if backend already has it, but interface requires it
          numRuns: 1,
          mode: existingEval.mode,
          scenarioName: existingEval.scenarioName,
        },
        (testCase) => {
          setEvaluations((prev) =>
            prev.map((ev) => {
              if (ev.id === existingEval.id) {
                const newIteration: EvaluationIteration = {
                  iterationIndex: ev.results.length + 1,
                  responseMatchScore: { score: testCase.response_match_score, reasoning: testCase.evaluations?.trajectory_match?.reasoning },
                  finalResponseMatchV2: { score: testCase.response_match_score, reasoning: testCase.evaluations?.trajectory_match?.reasoning },
                  hallucinationsV1: { score: testCase.hallucination_score, reasoning: testCase.evaluations?.llm_judge?.reasoning },
                  timestamp: new Date().toISOString(),
                };
                return { ...ev, results: [...ev.results, newIteration] };
              }
              return ev;
            }),
          );
        },
        (final) => {
          setEvaluations((prev) =>
            prev.map((ev) => {
              if (ev.id === existingEval.id) {
                return {
                  ...ev,
                  status: 'completed',
                  results: final.details.map((d: any, idx: number) => ({
                    iterationIndex: idx + 1,
                    responseMatchScore: { score: d.response_match_score, reasoning: d.evaluations?.trajectory_match?.reasoning },
                    finalResponseMatchV2: { score: d.response_match_score, reasoning: d.evaluations?.trajectory_match?.reasoning },
                    hallucinationsV1: { score: d.hallucination_score, reasoning: d.evaluations?.llm_judge?.reasoning },
                    timestamp: new Date().toISOString(),
                  })),
                };
              }
              return ev;
            }),
          );
          setLaunching(false);
        },
        (error) => {
          setEvaluations((prev) =>
            prev.map((ev) => {
              if (ev.id === existingEval.id) return { ...ev, status: 'failed', error };
              return ev;
            }),
          );
          setLaunching(false);
        },
      );
    } catch (err) {
      setLaunching(false);
    }
  };

  const handleLaunch = async () => {
    if (!agent || !selectedDatasetId) {
      toast.error('Select a dataset first');
      return;
    }

    setLaunching(true);

    // Add optimistic evaluation so user sees a "Running" row immediately
    const tempId = `optimistic-${Date.now()}`;
    const optimisticEval: Evaluation = {
      id: tempId,
      agentId: agent.id,
      scenarioName: runName,
      mode: runMode as any,
      status: 'processing',
      results: [],
      createdAt: new Date().toISOString(),
    };
    setEvaluations((prev) => [optimisticEval, ...prev]);

    try {
      const finalResult = await executeEvaluation({
        agentId: agent.id,
        datasetId: selectedDatasetId,
        numRuns: numRuns,
        mode: runMode,
        scenarioName: runName,
        judgeModel: judgeModel,
        threshold: threshold,
      });

      // Replace the optimistic row with the real final result
      if (finalResult) {
        setEvaluations((prev) => {
          const next = prev.map((ev) => (ev ? (ev.id === tempId ? finalResult : ev) : ev));
          // Update the details view if it is currently open for this eval
          if (selectedEvalForDetail?.id === tempId) {
            setSelectedEvalForDetail(finalResult);
          }
          return next;
        });
      }

      setLaunching(false);
      toast.success('Evaluation completed');
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';

      // Mark the optimistic row as failed instead of removing it
      setEvaluations((prev) => {
        const updated = prev.map((ev) => {
          if (ev && ev.id === tempId) {
            const failedEval = { ...ev, status: 'failed' as const, error: errorMsg };
            if (selectedEvalForDetail?.id === tempId) {
              setSelectedEvalForDetail(failedEval);
            }
            return failedEval;
          }
          return ev;
        });
        return updated;
      });

      setLaunching(false);
      toast.error('Launch error: ' + errorMsg);
    }
  };

  const handleDeleteEval = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteEvaluation(id);
      setEvaluations((prev) => prev.filter((ev) => ev.id !== id));
      toast.success('Evaluation deleted');
    } catch (error) {
      toast.error('Failed to delete evaluation');
    }
  };

  if (!agent) {
    return (
      <div className='flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-xl border-primary/20 bg-primary/5'>
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
            <Label className='text-sm font-bold text-slate-800'>Nom du scénario</Label>
            <div className='flex items-center'>
              <div className='relative flex-1'>
                <Input value={scenarioForm.name} onChange={(e) => setScenarioForm({ ...scenarioForm, name: e.target.value })} placeholder="Ex. Parcours d'onboarding" className='border-primary focus-visible:ring-primary h-10 pr-20 rounded-r-none' autoFocus />
                <div className='absolute right-0 top-0 h-full flex border-l border-primary'>
                  <button type='button' onClick={handleSaveScenario} className='h-full px-3 flex items-center justify-center bg-slate-200 hover:bg-slate-300 transition-colors text-slate-600'>
                    <Save className='h-4 w-4' />
                  </button>
                  <button type='button' onClick={() => setIsScenarioInlineOpen(false)} className='h-full px-3 flex items-center justify-center bg-slate-200 hover:bg-slate-300 transition-colors text-slate-600 border-l border-slate-300 rounded-r-md'>
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
                <div className='flex items-center gap-2 p-3 border border-primary rounded-lg bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors w-full max-w-sm'>
                  <div className='flex-1'>
                    <p className='text-[10px] text-primary font-bold uppercase tracking-wider'>{t('evaluation.scenarios.active')}</p>
                    <p className='font-bold text-sm'>{activeScenario?.name || 'Select Scenario'}</p>
                    <div className='flex gap-2 mt-1'>
                      <Badge variant='outline' className='text-[10px] font-normal px-1 py-0 h-4 bg-background/50'>
                        {datasets.find((d) => d.id === activeScenario?.datasetId)?.items.length || 0} questions
                      </Badge>
                      <Badge variant='outline' className='text-[10px] font-normal px-1 py-0 h-4 bg-background/50'>
                        {activeScenario?.numRuns || 1} configuration
                      </Badge>
                    </div>
                  </div>
                  <div className='flex gap-1 items-center'>
                    <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground hover:bg-primary/20' onClick={(e) => activeScenario && handleEditScenario(activeScenario, e)}>
                      <Pencil className='h-4 w-4' />
                    </Button>
                    <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10' onClick={(e) => activeScenario && handleDeleteScenario(activeScenario.id, e)}>
                      <Trash2 className='h-4 w-4' />
                    </Button>
                    <div className='h-8 w-8 flex items-center justify-center text-muted-foreground border-l ml-1 pl-1'>
                      <ChevronDown className='h-4 w-4' />
                    </div>
                  </div>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-[384px] p-1'>
                <DropdownMenuItem className='flex items-center gap-2 py-2 text-primary font-medium focus:text-primary cursor-pointer' onClick={handleCreateScenario}>
                  <Plus className='h-4 w-4' /> {t('evaluation.scenarios.create')}
                </DropdownMenuItem>
                {scenarios.map((sc) => (
                  <DropdownMenuItem
                    key={sc.id}
                    className='flex flex-col items-start gap-1 py-2 cursor-pointer'
                    onClick={() => {
                      setActiveScenario(sc);
                      applyScenario(sc);
                    }}>
                    <div className='font-semibold'>{sc.name}</div>
                    <div className='flex gap-1'>
                      <Badge variant='outline' className='text-[10px] px-1 py-0 scale-90 origin-left'>
                        {datasets.find((d) => d.id === sc.datasetId)?.items.length || 0} question
                      </Badge>
                      <Badge variant='outline' className='text-[10px] px-1 py-0 scale-90 origin-left'>
                        1 configuration
                      </Badge>
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
          <AccordionTrigger className='px-4 py-6 hover:no-underline bg-background/50 border-b border-border group transition-all'>
            <div className='flex items-center gap-4 text-left'>
              <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground font-bold shrink-0 shadow-[0_0_20px_rgba(var(--chart-1),0.4)] transition-transform group-hover:scale-110'>1</div>
              <div>
                <h4 className='font-bold text-lg text-foreground group-hover:text-primary transition-colors'>Dataset Q/R</h4>
                <p className='text-sm text-muted-foreground font-medium'>Préparez votre tableau question / réponse de référence.</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className='px-4 py-6 space-y-6'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-2 flex-1 max-w-xl'>
                <input type='file' ref={fileInputRef} className='hidden' accept='.xlsx,.csv' onChange={handleFileUpload} />
                <Button type='button' variant='outline' size='sm' className='h-10 text-primary border-primary font-bold hover:bg-primary/10 shrink-0 rounded-lg px-4' onClick={() => fileInputRef.current?.click()}>
                  <FileDown className='mr-2 h-4 w-4' />
                  Exporter en Excel
                </Button>

                <div className='flex-1 flex items-center h-10 border border-border rounded-lg overflow-hidden bg-muted/20 focus-within:border-primary transition-colors'>
                  <Input value={manualDatasetName} onChange={(e) => setManualDatasetName(e.target.value)} placeholder='dataset_reference.xlsx' className='border-none h-full focus-visible:ring-0 text-sm bg-transparent' />
                  {manualItems.length > 0 && (
                    <div className='flex items-center h-full px-1 gap-1'>
                      <button type='button' onClick={handleSaveManualDataset} className='w-8 h-8 rounded flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm' title='Sauvegarder'>
                        <Save className='h-4 w-4' />
                      </button>
                      <button type='button' onClick={handleCancelManual} className='w-8 h-8 rounded flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors' title='Annuler'>
                        <Trash2 className='h-4 w-4' />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className='relative w-[320px] group'>
                <label className='absolute -top-2 left-3 bg-background px-2 text-[10px] text-primary uppercase font-black tracking-widest z-20'>Datasets enregistrés</label>
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
                  <SelectTrigger className='w-full h-12 border-primary/30 rounded-xl bg-primary/5 backdrop-blur-md pt-4 hover:border-primary transition-colors'>
                    <div className='flex flex-col items-start text-left'>
                      <SelectValue placeholder='Choisir un dataset...' />
                    </div>
                  </SelectTrigger>
                  <SelectContent className='bg-card border-primary/20'>
                    {datasets.map((ds) => (
                      <SelectItem key={ds.id} value={ds.id} className='flex items-center justify-between group py-3'>
                        <div className='flex items-center justify-between w-full'>
                          <span>{ds.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='space-y-0 relative pb-12'>
              {manualItems.length > 0 ? (
                <div className='rounded-xl overflow-hidden border border-primary/20 bg-background/60 backdrop-blur-md overflow-x-hidden shadow-2xl'>
                  <div className='flex w-full bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-bold text-[11px] uppercase tracking-widest sticky top-0 z-20 shadow-lg border-b border-white/10'>
                    <div className='flex-1 py-4 px-6 text-center border-r border-white/10 uppercase font-black'>Question</div>
                    <div className='flex-1 py-4 px-6 text-center uppercase font-black'>Réponse</div>
                    <div className='w-15'></div>
                  </div>

                  <div className='divide-y divide-primary/10 max-h-[500px] overflow-y-auto custom-scrollbar p-2 space-y-2'>
                    {/* Manual items */}
                    {manualItems.map((item, i) => (
                      <div key={`manual-${i}`} className='flex gap-3 items-center animate-in fade-in slide-in-from-top-2 duration-300 p-2 bg-primary/5 rounded-lg border border-primary/10 group relative pr-14'>
                        <div className='flex-1 relative'>
                          <div className='bg-card border border-white/10 rounded-lg p-3 shadow-inner group-hover:border-primary/30 transition-all'>
                            <textarea value={item?.question || ''} onChange={(e) => handleUpdateManualRow(i, 'question', e.target.value)} placeholder='Saisissez votre question ici...' className='w-full min-h-20 bg-transparent border-none outline-none text-sm resize-none focus:ring-0 placeholder:text-muted-foreground/20 text-slate-200' />
                            <Pencil className='absolute top-2 right-2 h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity text-primary' />
                          </div>
                        </div>
                        <div className='flex-1 relative'>
                          <div className='bg-card border border-white/10 rounded-lg p-3 shadow-inner group-hover:border-primary/30 transition-all'>
                            <textarea value={item?.reference_answer || ''} onChange={(e) => handleUpdateManualRow(i, 'reference_answer', e.target.value)} placeholder='Saisissez la réponse attendue...' className='w-full min-h-20 bg-transparent border-none outline-none text-sm resize-none focus:ring-0 placeholder:text-muted-foreground/20 text-slate-200' />
                            <Pencil className='absolute top-2 right-2 h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity text-primary' />
                          </div>
                        </div>
                        <div className='absolute right-3 top-1/2 -translate-y-1/2'>
                          <Button type='button' variant='ghost' size='icon' className='h-10 w-10 text-muted-foreground/40 hover:text-white hover:bg-destructive rounded-full transition-all border border-transparent hover:border-destructive/20 shadow-sm' onClick={() => handleRemoveManualRow(i)}>
                            <Trash2 className='h-5 w-5' />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className='text-center py-12 flex flex-col items-center gap-4 border-2 border-dashed rounded-xl bg-muted/5 border-primary/10'>
                  <p className='text-muted-foreground italic'>Préparez votre tableau question / réponse de référence.</p>
                </div>
              )}

              {/* Floating add button */}
              <div className='absolute -bottom-6 left-1/2 -translate-x-1/2 z-20'>
                <button type='button' onClick={handleAddManualRow} className='w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 hover:scale-110 active:scale-95 transition-all flex items-center justify-center group'>
                  <Plus className='h-6 w-6 group-hover:rotate-90 transition-transform duration-300' />
                </button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value='evaluations' className='border rounded-xl overflow-hidden bg-card shadow-sm'>
          <AccordionTrigger className='px-4 py-6 hover:no-underline bg-background/50 border-b border-border group transition-all'>
            <div className='flex items-center gap-4 text-left'>
              <div className='flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground font-bold shrink-0'>2</div>
              <div>
                <h4 className='font-bold text-lg text-foreground'>{t('evaluation.evaluations.title')}</h4>
                <p className='text-sm text-muted-foreground font-medium'>{t('evaluation.evaluations.description')}</p>
              </div>
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
                  <SelectContent className='bg-card border-primary/20'>
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
          <AccordionTrigger className='px-4 py-6 hover:no-underline bg-background/50 border-b border-border group transition-all'>
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
                        const avgResp = ev.results.length > 0 ? ev.results.reduce((acc, r) => acc + (r.responseMatchScore?.score || 0), 0) / ev.results.length : 0;
                        const avgFinal = ev.results.length > 0 ? ev.results.reduce((acc, r) => acc + (r.finalResponseMatchV2?.score || 0), 0) / ev.results.length : 0;
                        const avgHallu = ev.results.length > 0 ? ev.results.reduce((acc, r) => acc + (r.hallucinationsV1?.score || 0), 0) / ev.results.length : 0;
                        return (
                          <tr key={ev.id || Math.random().toString()} className='hover:bg-muted/30 transition-colors'>
                            <td className='px-4 py-3 font-medium'>
                              {ev.scenarioName} {ev.status === 'processing' && <Loader2 className='inline ml-2 h-3 w-3 animate-spin text-primary' />}
                            </td>
                            <td className='px-4 py-3 text-xs text-muted-foreground'>{new Date(ev.createdAt).toLocaleString()}</td>
                            <td className='px-4 py-3 text-center'>
                              <Badge variant='outline' className='text-primary border-primary/20'>
                                {Math.round(avgResp * 100)}%
                              </Badge>
                            </td>
                            <td className='px-4 py-3 text-center'>
                              <Badge variant='outline' className='text-primary border-primary/20'>
                                {Math.round(avgFinal * 100)}%
                              </Badge>
                            </td>
                            <td className='px-4 py-3 text-center'>
                              <Badge variant='outline' className='text-primary border-primary/20'>
                                {Math.round(avgHallu * 100)}%
                              </Badge>
                            </td>
                            <td className='px-4 py-3 text-center'>
                              <div className='flex justify-center gap-1'>
                                <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground' onClick={() => setSelectedEvalForDetail(ev)}>
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
      <Dialog open={!!selectedEvalForDetail} onOpenChange={(open) => !open && setSelectedEvalForDetail(null)}>
        <DialogContent className='max-w-6xl max-h-[90vh] overflow-hidden flex flex-col'>
          <DialogHeader>
            <DialogTitle>Détails de l'évaluation: {selectedEvalForDetail?.scenarioName}</DialogTitle>
            <DialogDescription>Analyse détaillée par question et itération.</DialogDescription>
          </DialogHeader>

          <div className='flex-1 overflow-auto mt-4 pr-1'>
            <Table>
              <TableHeader>
                <TableRow className='bg-muted/50 border-primary/20'>
                  <TableHead className='w-10 text-[10px] font-black uppercase tracking-tighter'>#</TableHead>
                  <TableHead className='min-w-50 text-[10px] font-black uppercase tracking-widest text-primary'>Question</TableHead>
                  <TableHead className='min-w-50 text-[10px] font-black uppercase tracking-widest text-primary'>Réponse Attendue</TableHead>
                  <TableHead className='min-w-50 text-[10px] font-black uppercase tracking-widest text-primary'>Réponse Obtenue</TableHead>
                  <TableHead className='w-25 text-center text-[10px] font-black uppercase tracking-widest text-primary'>Scores</TableHead>
                  <TableHead className='min-w-[250px] text-[10px] font-black uppercase tracking-widest text-primary'>Raisonnement / Détails</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  // Find the live evaluation object to ensure real-time updates in the dialog
                  const liveEval = evaluations.find((e) => e.id === selectedEvalForDetail?.id);
                  let resultsToDisplay = liveEval?.results || selectedEvalForDetail?.results || [];

                  // Sort by index to ensure 1, 2, 3... order
                  resultsToDisplay = [...resultsToDisplay].sort((a, b) => (a.iterationIndex || 0) - (b.iterationIndex || 0));

                  if (resultsToDisplay.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>
                          Aucun détail disponible pour cette évaluation. {liveEval?.status === 'processing' && '(En cours...)'}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return resultsToDisplay.map((res) => (
                    <TableRow key={`${selectedEvalForDetail?.id}-${res.iterationIndex}`} className='group hover:bg-primary/5 transition-colors border-primary/10'>
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
                  ));
                })()}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
