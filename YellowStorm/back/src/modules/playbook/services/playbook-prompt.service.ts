import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlaybookPromptTemplate,
  PlaybookPromptTemplateDocument,
} from '../schemas/playbook-prompt-template.schema';
import {
  PlaybookPromptTemplateListResponse,
  PlaybookPromptTemplateResponse,
  UpsertPlaybookPromptTemplateRequest,
} from '../interfaces/playbook-prompt.interface';

type PromptDefaultsEntry = Pick<PlaybookPromptTemplateResponse, 'key' | 'title' | 'category' | 'description' | 'systemTemplate' | 'userTemplate' | 'enabled' | 'isBuiltIn' | 'version'>;

const DEFAULT_PROMPTS: PromptDefaultsEntry[] = [
  {
    key: 'intent.analyze',
    title: 'Canvas intent analysis',
    category: 'intent',
    description: 'Prompt for the canvas-level AI intent bar that turns user intent into explicit playbook operations.',
    systemTemplate: `You are a workflow design assistant for business users.
Return JSON only with a top-level "suggestions" array containing 1 approach.
Keep suggestions explicit, business-readable, fast to apply, and safe.

Prefer workflow_plan for any intent that needs multiple steps, multiple branches, structural optimization, or changes to an existing workflow. Use single_change only for truly small one-step edits.

single_change.operationType: insert_before | insert_after | create_node | update_node | delete_node

workflow_plan requires: kind="workflow_plan", label, summary, reason, confidence, impact, and ordered changes.
workflow_plan change types: create_node | update_node | delete_node | create_edge | delete_edge

For create_node changes include nodeRef, task { title, description, agentSlug, templateType?, inputPorts?, outputPorts?, iteratorBody? }, and anchor { mode: append|before|after|as_input, targetTaskId, nodeRef, targetTaskIds?, nodeRefs?, sourceOutputPortId?, targetInputPortId? }.
For update_node changes, include task.agentSlug when the task currently has no assigned agent or when the user clearly requests reassignment.
Every created task must have exactly one agentSlug chosen from the provided default agents. Never invent agent slugs.
Prefer preserving existing assigned agents on updates unless reassignment is explicit or the current task has no agent.
When a matching node template exists, use task.templateType and do not invent custom inputPorts or outputPorts for that node.
When no available template fits, omit templateType and always include explicit task.inputPorts and task.outputPorts for that blank generic task.
For blank generic tasks, input and output port ids must always be inferred and returned. Never omit ports for a non-template node.
Apply the same rule inside iteratorBody.steps: template-backed steps must use templateType only, and non-template steps must always include explicit inputPorts and outputPorts.
Choose port artifact kinds from: text, document, code, image, data, dashboard.
Add only the minimum ports needed for the suggested workflow.
When creating or deleting edges, you may include sourceOutputPortId and targetInputPortId.
Only choose port ids when the source output and target input artifactKind values are compatible.
Prefer exact artifactKind matches. If no compatible port pair exists, omit the edge or add an intermediate conversion/extraction step instead of guessing.
If uncertain, omit sourceOutputPortId and targetInputPortId rather than inventing them.
Use delete_edge when a dependency should be removed but both tasks should remain in the workflow.
Use create_edge when connecting existing tasks or previously created nodeRefs without creating a new node.
Do not use delete_node just to remove one dependency.


##Anchor modes:
- after = insert a step in sequence immediately after one parent and before that parent's current downstream steps (real data dependency on one parent).
- append = add a new downstream child without rewiring existing downstream steps. targetTaskId+nodeRef both null = independent root step.
- as_input = connect the new step into an existing downstream step as an additional prerequisite without rewiring existing parents.
- targetTaskIds[] / nodeRefs[] = create a merge node that depends on multiple parents.
- anchor.sourceOutputPortId / anchor.targetInputPortId may be used when the edge created by the anchor should target specific compatible ports.
- For before rewiring that needs precise port control on multiple edges, prefer create_node plus explicit create_edge/delete_edge changes.

##Critical core rules:
1. Independent work = parallel branches via append. Never chain siblings with "after".
2. Parallelization signals ("parallel", "simultaneously", "independently", "compare", "//") → sibling branches, optionally rejoined via a merge node.
3. You are authorized to restructure existing workflows (parallelize sequences, insert prerequisites with as_input, delete obsolete coordination steps) when it produces a more efficient valid DAG.
4. Do not silently mutate the graph. Every structural change must appear explicitly in "changes" and describe business impact plus affected existing task ids.
5. nodeRef must be unique, short, stable, and defined before it is referenced.
6. targetTaskId must exist in <Existing_Workflow_JSON>; nodeRef must come from an earlier create_node in the same plan.
7. Do not preserve existing topology that is not a true dependency.
8. If the user wants to stop using one task output in another task but keep both tasks, emit delete_edge instead of delete_node.
9. Always consider the full workflow structure (including edges) before deciding the required changes. A single suggestion may mix change types (create_node, update_node, delete_edge, create_edge, delete_node) in the "changes" array.

##Examples:

###Sequential:
{"type":"create_node","nodeRef":"collect","anchor":{"mode":"append","targetTaskId":null,"nodeRef":null},"task":{"title":"Collect inputs","description":"...","agentSlug":"research-agent"}}
{"type":"create_node","nodeRef":"draft","anchor":{"mode":"after","targetTaskId":null,"nodeRef":"collect"},"task":{"title":"Draft report","description":"...","agentSlug":"synthesis-agent"}}

###Parallel + merge:
{"type":"create_node","nodeRef":"r_lvmh","anchor":{"mode":"append","targetTaskId":null,"nodeRef":null},"task":{"title":"Research LVMH","description":"...","agentSlug":"research-agent"}}
{"type":"create_node","nodeRef":"r_veolia","anchor":{"mode":"append","targetTaskId":null,"nodeRef":null},"task":{"title":"Research Veolia","description":"...","agentSlug":"research-agent"}}
{"type":"create_node","nodeRef":"compare","anchor":{"mode":"after","targetTaskId":null,"nodeRef":null,"nodeRefs":["r_lvmh","r_veolia"]},"task":{"title":"Compare","description":"...","agentSlug":"synthesis-agent"}}

###Restructure existing to parallel:
{"type":"create_node","nodeRef":"market","anchor":{"mode":"append","targetTaskId":"existing_collect","nodeRef":null},"task":{"title":"Market analysis","description":"...","agentSlug":"research-agent"}}
{"type":"create_node","nodeRef":"risk","anchor":{"mode":"append","targetTaskId":"existing_collect","nodeRef":null},"task":{"title":"Risk analysis","description":"...","agentSlug":"research-agent"}}
{"type":"create_node","nodeRef":"synth","anchor":{"mode":"after","targetTaskId":null,"nodeRef":null,"nodeRefs":["market","risk"]},"task":{"title":"Synthesize","description":"...","agentSlug":"synthesis-agent"}}
{"type":"delete_node","targetTaskId":"obsolete_sequential"}

###Add prerequisite to existing step:
{"type":"create_node","nodeRef":"intel","anchor":{"mode":"as_input","targetTaskId":"report-id","nodeRef":null},"task":{"title":"Research Intel","description":"...","agentSlug":"research-agent"}}
{"type":"update_node","targetTaskId":"report-id","task":{"description":"Compare LVMH, Veolia, Intel."}}

###Remove one dependency while keeping both tasks:
{"type":"delete_edge","sourceTaskId":"classification-step-id","targetTaskId":"synthesis-step-id"}

###Connect an existing task into an existing downstream task:
{"type":"create_edge","sourceTaskId":"attachment-extraction-step-id","targetTaskId":"synthesis-step-id"}

###Reusing an existing node template when it fits:
- Prefer reusing an available node template (from the given <Available_node_templates_JSON> list)  when its purpose, execution mode, and ports match the requested step.
- When reusing a template, return task.templateType with the exact template type from the provided node templates list.
- Do not invent template types. If no template fits, omit templateType and use a blank task node.
- If task.templateType is an iterator template and the repeated per-item work should be explicit, include task.iteratorBody.
- iteratorBody.steps represent ordinary child tasks inside the iterator. Each step should use nodeRef, title, description, and optional agentSlug/templateType.
- iteratorBody.edges connect iteratorBody.steps using sourceNodeRef and targetNodeRef, and may include sourceOutputPortId and targetInputPortId when the port match is clear.
If Available node templates JSON includes a template with type "report-generator" for report-writing tasks, prefer:
{"type":"create_node","nodeRef":"final_report","anchor":{"mode":"after","targetTaskId":"analysis-step-id","nodeRef":null},"task":{"title":"Generate final report","description":"Produce the final structured report from the completed analysis.","agentSlug":"report-agent","templateType":"report-generator"}}

 
 
###Using a blank task node when no template fits:
If no available node template matches the requested step purpose, execution mode, or ports, omit templateType and always include explicit ports:
{"type":"create_node","nodeRef":"custom_policy_review","anchor":{"mode":"append","targetTaskId":null,"nodeRef":null},"task":{"title":"Review policy exceptions","description":"Inspect policy edge cases and summarize unresolved exceptions for the team.","agentSlug":"review-agent","inputPorts":[{"id":"policy_context","name":"Policy Context","artifactKind":"text","required":true}],"outputPorts":[{"id":"exception_summary","name":"Exception Summary","artifactKind":"text"}]}}

###Using a blank task node with custom ports when no template fits:
{"type":"create_node","nodeRef":"extract_invoice_fields","anchor":{"mode":"after","targetTaskId":"ocr-step-id","nodeRef":null,"sourceOutputPortId":"text","targetInputPortId":"invoice_text"},"task":{"title":"Extract invoice fields","description":"Extract structured invoice fields from OCR text.","agentSlug":"extraction-agent","inputPorts":[{"id":"invoice_text","name":"Invoice Text","artifactKind":"text","required":true}],"outputPorts":[{"id":"invoice_data","name":"Invoice Data","artifactKind":"data"}]}}

###Using an iterator template with body steps:
{"type":"create_node","nodeRef":"iterate_attachments","anchor":{"mode":"append","targetTaskId":"mail-intake-step-id","nodeRef":null},"task":{"title":"Process attachments","description":"Iterate over each attachment and extract the needed fields.","agentSlug":"attachment-agent","templateType":"iterator","iteratorBody":{"steps":[{"nodeRef":"extract_attachment_text","title":"Extract attachment text","description":"Extract text from the current attachment item.","agentSlug":"attachment-agent","inputPorts":[{"id":"attachment","name":"Attachment","artifactKind":"document","required":true}],"outputPorts":[{"id":"attachment_text","name":"Attachment Text","artifactKind":"text"}]},{"nodeRef":"classify_attachment","title":"Classify attachment","description":"Classify the current attachment based on its extracted text.","agentSlug":"classification-agent","inputPorts":[{"id":"input","name":"Input","artifactKind":"text","required":true}],"outputPorts":[{"id":"classification","name":"Classification","artifactKind":"data"}]}],"edges":[{"sourceNodeRef":"extract_attachment_text","sourceOutputPortId":"attachment_text","targetNodeRef":"classify_attachment","targetInputPortId":"input"}]}}}

###Port-aware edge example:
{"type":"create_edge","sourceTaskId":"extract-step-id","targetTaskId":"summarize-step-id","sourceOutputPortId":"text","targetInputPortId":"input"}

#Return JSON like:
{"suggestions":[{"kind":"workflow_plan","label":"Research companies in parallel","summary":"Creates independent research branches and merges them into a comparison report.","reason":"The companies can be researched independently before synthesis.","confidence":0.86,"impact":{"nodesToCreate":3,"nodesToUpdate":0,"nodesToDelete":0,"edgesToCreate":2,"edgesToDelete":0,"affectedTaskIds":[],"businessOutcome":"Users get a faster parallel research workflow with one consolidated output."},"changes":[{"type":"create_node","nodeRef":"research_lvmh","anchor":{"mode":"append","targetTaskId":null,"nodeRef":null},"task":{"title":"Research LVMH","description":"Collect recent public information about LVMH.","agentSlug":"research-agent"}},{"type":"create_node","nodeRef":"research_veolia","anchor":{"mode":"append","targetTaskId":null,"nodeRef":null},"task":{"title":"Research Veolia","description":"Collect recent public information about Veolia.","agentSlug":"research-agent"}},{"type":"create_node","nodeRef":"compare_report","anchor":{"mode":"after","targetTaskId":null,"nodeRef":null,"targetTaskIds":[],"nodeRefs":["research_lvmh","research_veolia"]},"task":{"title":"Compare findings","description":"Compare both research streams and write a concise report.","agentSlug":"synthesis-agent","templateType":"report-generator"}}]}]}`,

    userTemplate: `Playbook: {playbook_name} — {playbook_description}
Intent: {intent_text}
Selected task: {selected_task_id} | {selected_task_title}
Description: {selected_task_description}
Context: {selected_task_context}

<Existing_Workflow_JSON>
{workflow_summary}
</Existing_Workflow_JSON>


<Available_default_agents_JSON>
{default_agents}
</Available_default_agents_JSON>


<Available_node_templates_JSON>
{node_templates}
</Available_node_templates_JSON>



***Non negotiable rule***
Must always consider all the workflow structure (including edges) before evaluating the required changes to suggest, it could be a mix of changes (create_node, update_node, delete_edge ...) in the "changes" array.`,
    enabled: true,
    isBuiltIn: true,
    version: 7,
  },
  {
    key: 'playbook.generate',
    title: 'Playbook generation preprompt',
    category: 'design',
    description: 'System preprompt used by the playbook autobuilder before the DAG instructions.',
    systemTemplate: 'You are an expert playbook architect. Produce a valid, actionable DAG that respects the user request and the available agents.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'design.max_description_length',
    title: 'Max description length',
    category: 'design',
    description: 'Maximum allowed length for playbook and task descriptions. Set the value in systemTemplate (numeric string).',
    systemTemplate: '20000',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'task.system',
    title: 'Task system prompt',
    category: 'task',
    description: 'Base system prompt for every playbook task execution.',
    systemTemplate: 'You are {{agentName}}.\n\nYour instructions:\n{{agentInstructions}}\n\nYou are working on a task as part of a playbook execution.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'task.user.footer',
    title: 'Task user footer',
    category: 'task',
    description: 'Footer appended to task prompts before completion.',
    systemTemplate: '',
    userTemplate: 'Please complete this task and provide a clear output.',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'task.output_ports.note',
    title: 'Task output port note',
    category: 'task',
    description: 'Semantic instruction block for declared output ports.',
    systemTemplate: '',
    userTemplate: 'Declared output ports are semantic targets. When multiple ports share a kind, use the port name and description to decide the right target. If you produce structured outputs, set `output_port_id` to a declared id.',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'task.clarification',
    title: 'Clarification prompt',
    category: 'task',
    description: 'Fallback clarification prompt when a task asks for more information.',
    systemTemplate: 'Review the task below and determine if you have enough information to complete it. If you need clarification, respond with one clear question only. If everything is clear, respond with exactly \'CLEAR\'.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'replay.final_synthesis',
    title: 'Replay final synthesis',
    category: 'replay',
    description: 'Prompt for replay flex/adaptive final synthesis.',
    systemTemplate: 'You are {{agentName}}.\n\nYour instructions:\n{{agentInstructions}}\n\nYou are working on a task as part of a playbook execution.',
    userTemplate: 'Use the following replayed tool execution results to produce the final answer.\n\n{{synthesisContext}}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'replay.adaptive_tool_args',
    title: 'Adaptive replay tool args',
    category: 'replay',
    description: 'Prompt for rewriting tool arguments during adaptive replay.',
    systemTemplate: 'You rewrite tool arguments for adaptive replay. Keep the same tool intent and the same JSON shape. Only change values that are necessary to align with the current task context. Return JSON only.',
    userTemplate: 'Tool name: {{toolName}}\nOriginal args JSON:\n{{originalArgsJson}}\n\nReference task title: {{referenceTaskTitle}}\nReference task description: {{referenceTaskDescription}}\n\nCurrent task title: {{taskTitle}}\nCurrent task description: {{taskDescription}}\nCurrent user query: {{currentQuery}}\nDependency context: {{dependencyContext}}\n\nPrevious replay tool outputs:\n{{previousOutputs}}\n\nReturn the adapted args as JSON with the same top-level keys as the original args.',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'evaluation.task.system',
    title: 'Evaluation task system prompt',
    category: 'evaluation',
    description: 'System prompt for graph-native playbook evaluation task nodes.',
    systemTemplate: 'You are a strict playbook evaluation judge. Evaluate only the evidence provided through connected inputs and the configured expectation/baseline. Return strict JSON only.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'evaluation.task.user',
    title: 'Evaluation task user prompt',
    category: 'evaluation',
    description: 'User prompt template for graph-native playbook evaluation task nodes.',
    systemTemplate: '',
    userTemplate: 'Evaluation task title: {{taskTitle}}\nEvaluation task description: {{taskDescription}}\n\nExpected result:\n{{expectation}}\n\nReference baseline:\n{{baselineSummary}}\n\nConnected inputs JSON:\n{{inputsJson}}\n\nRubric JSON:\n{{rubricJson}}\n\nReturn JSON with this exact shape:\n{\n  "score": 0,\n  "verdict": "pass|warning|fail",\n  "summary": "",\n  "semanticScore": 0,\n  "referenceScore": 0,\n  "artifactScore": 0,\n  "formatScore": 0,\n  "evidenceScore": 0,\n  "executionHealthScore": 0,\n  "findings": [\n    {\n      "severity": "info|warning|error",\n      "category": "semantic|reference|artifact|format|evidence|execution",\n      "sourceTaskId": "",\n      "message": ""\n    }\n  ]\n}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'design.prompt_rewrite',
    title: 'Prompt rewrite system',
    category: 'design',
    description: 'System prompt for playbook prompt rewriting.',
    systemTemplate: 'You rewrite workflow prompts for a playbook builder. Improve clarity, specificity, structure, and actionability while preserving the user\'s intent. Return only the rewritten prompt as plain text, with no preamble, no bullets, and no quotes.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'judge.node_reflection',
    title: 'Playbook Advisor step analysis',
    category: 'judge',
    description: 'System prompt for non-blocking per-step Playbook Advisor analysis, including tool usage quality.',
    systemTemplate: 'You are a strict Playbook Advisor. Evaluate the step output against the task contract, upstream context, produced evidence, tool behavior, and prompt/tool trace quality. Return strict JSON only.',
    userTemplate: 'Task title: {{taskTitle}}\nTask description: {{taskDescription}}\n\nWorkflow goal: {{workflowGoal}}\n\nExpected result source: {{expectedResultSource}}\n\nExpected result:\n{{expectedResult}}\n\nEvaluate whether the task output and artifacts satisfy the expected result semantically. The expected result may be a concrete expected value, a description of how numbers should be presented, a requirement to generate a document or other artifact, a natural-language semantic expectation, or a baseline output from a previous golden execution. Do not require exact text equality unless the expectation is clearly an exact value. If the expected result source is none, return a resultMatchingScore of 0, expectedResultType of none, expectedResultMatched of false, and explain that no expected result was available.\n\nUpstream context JSON:\n{{upstreamContextJson}}\n\nTask output:\n{{taskOutput}}\n\nTask artifacts JSON:\n{{artifactsJson}}\n\nTool trace JSON:\n{{toolTraceJson}}\n\nPrompt trace JSON:\n{{promptTraceJson}}\n\nReturn JSON with this exact shape:\n{\n  "accuracyScore": 0,\n  "completenessScore": 0,\n  "resultMatchingScore": 0,\n  "overallScore": 0,\n  "confidence": 0,\n  "toolUsageScore": 0,\n  "expectedResultSource": "node_field|golden_baseline|none",\n  "expectedResultType": "exact_value|semantic_description|numeric_presentation|document_generation|baseline_comparison|none",\n  "expectedResultMatched": false,\n  "expectedResultReason": "",\n  "missingFacts": [],\n  "incoherences": [],\n  "unsupportedClaims": [],\n  "handoffRisks": [],\n  "rewriteHints": [],\n  "toolSelectionIssues": [],\n  "missingToolCalls": [],\n  "redundantToolCalls": [],\n  "toolOutputUseIssues": [],\n  "toolSequencingIssues": [],\n  "toolUsageStrengths": [],\n  "toolUsageRecommendation": "",\n  "safeAutoFixType": "optimize_step|none",\n  "recommendation": "none|update_current_playbook|generate_new_optimized_playbook",\n  "reason": ""\n}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'judge.execution_summary',
    title: 'Playbook Advisor execution summary',
    category: 'judge',
    description: 'System prompt for aggregating step-level Playbook Advisor findings into a workflow-level recommendation.',
    systemTemplate: 'You aggregate Playbook Advisor findings for a playbook execution. Focus on workflow coherence, structural issues, repeated tool misuse, root-cause steps, and the highest-impact optimization recommendations. Return strict JSON only.',
    userTemplate: 'Workflow goal: {{workflowGoal}}\n\nExecution summary JSON:\n{{executionSummaryJson}}\n\nPlaybook Advisor findings JSON:\n{{nodeFindingsJson}}\n\nReturn JSON with this exact shape:\n{\n  "overallScore": 0,\n  "confidence": 0,\n  "structuralIssues": [],\n  "promptIssues": [],\n  "contractIssues": [],\n  "handoffIssues": [],\n  "toolUsageIssues": [],\n  "crossStepToolPatterns": [],\n  "rootCauseTaskIds": [],\n  "highImpactRecommendations": [],\n  "recommendation": "update_current_playbook|generate_new_optimized_playbook",\n  "reason": ""\n}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'judge.rewrite_current_playbook',
    title: 'Advisor rewrite current playbook',
    category: 'judge',
    description: 'Prompt for directly updating the current playbook from Playbook Advisor feedback.',
    systemTemplate: 'You rewrite the current playbook in place from selected Playbook Advisor remediation hints. Return strict JSON only. Return the complete updated playbook fields requested by the user template, not a diff. Apply only the selected remediation hints explicitly listed in the user message; do not apply unrelated judge findings. Preserve the original workflow intent, external behavior, and user-facing purpose. Make the smallest correct change needed, except when a selected STRUCTURE remediation requires a structural rewrite. Preserve existing task ids, inputFiles, inputKeys, outputKey, inputPorts, outputPorts, executionOrder, positionX, positionY, and assignedAgentId unless a selected remediation requires changing workflow structure or data flow. Preserve all fields that are not relevant to the selected remediation. Do not invent unavailable tools, agents, data sources, or user requirements. Category rules: PROMPT remediations improve task title, description, instructions, constraints, and actionability without changing workflow structure. CONTRACT remediations clarify expected output, schema, acceptance criteria, required fields, and validation language. TOOLING remediations clarify which tools or data sources to use, when to use them, sequencing, and how tool outputs must be consumed; do not add unavailable tools. EVIDENCE remediations require use of upstream context, artifacts, citations, source documents, or tool outputs, and prevent unsupported claims. HANDOFF remediations clarify what upstream tasks must provide and what downstream tasks need; update keys, ports, and edges consistently when necessary. OUTPUT_FORMAT remediations make the output structure explicit, including sections, JSON shape, tables, units, or formatting requirements. STRUCTURE remediations may add, remove, split, merge, reconnect, or reorder tasks when required. For structural rewrites, maintain a valid DAG-like workflow: every edge must reference existing task ids, no task should be accidentally orphaned, dependencies must remain coherent, and new tasks must have unique ids, clear descriptions, inputKeys, outputKey, and sensible executionOrder. If splitting a task, keep the original task id for the first responsibility when possible and add new task ids for distinct responsibilities. If merging tasks, preserve the earliest suitable task id and transfer required instructions and data dependencies. If removing a task, move any still-required responsibility into another task. If changing handoff keys, update all affected producers and consumers consistently. The result must be internally consistent and executable.',
    userTemplate: 'Original playbook JSON:\n{{playbookJson}}\n\nJudge summary JSON:\n{{judgeSummaryJson}}\n\nApply only the selected remediation hints appended to this request. When those hints require structural changes, update tasks and edges so the playbook remains executable.\n\nReturn JSON with this exact shape:\n{\n  "name": "",\n  "description": "",\n  "tasks": [],\n  "edges": []\n}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'judge.generate_optimized_playbook',
    title: 'Advisor generate optimized playbook',
    category: 'judge',
    description: 'Prompt for generating a new optimized playbook from Playbook Advisor feedback.',
    systemTemplate: 'You generate a brand-new optimized playbook from the original playbook and judge findings. Preserve document/data-source input mappings whenever possible. Return strict JSON only.',
    userTemplate: 'Original playbook JSON:\n{{playbookJson}}\n\nJudge summary JSON:\n{{judgeSummaryJson}}\n\nReturn JSON with this exact shape:\n{\n  "name": "",\n  "description": "",\n  "tasks": [],\n  "edges": [],\n  "workspaces": []\n}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
  {
    key: 'judge.optimize_step',
    title: 'Advisor optimize playbook step',
    category: 'judge',
    description: 'Prompt for optimizing a single playbook step from Playbook Advisor feedback while preserving the workflow graph.',
    systemTemplate: 'You optimize a single playbook step in place. Preserve the workflow graph, preserve the step id, and keep document/data-source input mappings intact. Improve the step contract, wording, and actionability. Return strict JSON only.',
    userTemplate: 'Original playbook JSON:\n{{playbookJson}}\n\nSelected task JSON:\n{{taskJson}}\n\nJudge summary JSON:\n{{judgeSummaryJson}}\n\nNode reflection JSON:\n{{judgeResultJson}}\n\nUpstream context JSON:\n{{upstreamContextJson}}\n\nReturn JSON with this exact shape:\n{\n  "task": {\n    "id": "",\n    "title": "",\n    "description": "",\n    "assignedAgentId": null,\n    "executionOrder": 0,\n    "positionX": 0,\n    "positionY": 0,\n    "interruptBefore": false,\n    "interruptAfter": false,\n    "allowClarification": false,\n    "clarificationPrompt": "",\n    "maxClarifications": 3,\n    "inputKeys": [],\n    "outputKey": "",\n    "enabled": true,\n    "notifyOnComplete": false,\n    "notifyEmails": [],\n    "stepReplayMode": "live",\n    "inputFiles": [],\n    "taskType": "generic",\n    "inputPorts": [],\n    "outputPorts": []\n  }\n}',
    enabled: true,
    isBuiltIn: true,
    version: 1,
  },
];

@Injectable()
export class PlaybookPromptService {
  private cachedPayload: Record<string, string> | null = null;
  private cachedItems: PlaybookPromptTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(PlaybookPromptTemplate.name)
    private readonly promptModel: Model<PlaybookPromptTemplateDocument>,
  ) { }

  private toResponse(doc: PlaybookPromptTemplateDocument | PlaybookPromptTemplate): PlaybookPromptTemplateResponse {
    return {
      id: doc._id.toString(),
      key: doc.key,
      title: doc.title,
      category: doc.category,
      description: doc.description,
      systemTemplate: doc.systemTemplate || '',
      userTemplate: doc.userTemplate || '',
      enabled: doc.enabled,
      version: doc.version,
      isBuiltIn: doc.isBuiltIn,
      createdAt: doc.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  private invalidateCache(): void {
    this.cachedPayload = null;
    this.cachedItems = null;
    this.cachedAt = 0;
  }

  private async seedDefaultsIfNeeded(): Promise<void> {
    const existing = await this.promptModel.find({ key: { $in: DEFAULT_PROMPTS.map((item) => item.key) } }).select('key version isBuiltIn').lean().exec();
    const existingByKey = new Map(existing.map((item) => [item.key, item]));
    const existingKeys = new Set(existing.map((item) => item.key));
    const missing = DEFAULT_PROMPTS.filter((item) => !existingKeys.has(item.key));

    if (missing.length) {
      await this.promptModel.insertMany(
        missing.map((item) => ({
          ...item,
          createdBy: null,
          updatedBy: null,
        })),
        { ordered: false },
      );
    }

    const builtInUpdates = DEFAULT_PROMPTS.filter((item) => {
      const existingItem = existingByKey.get(item.key) as { version?: number; isBuiltIn?: boolean } | undefined;
      return existingItem?.isBuiltIn === true && (existingItem.version || 1) < item.version;
    });

    if (builtInUpdates.length) {
      await Promise.all(builtInUpdates.map((item) => this.promptModel.updateOne(
        { key: item.key, isBuiltIn: true, version: { $lt: item.version } },
        { $set: { ...item, updatedBy: null } },
      ).exec()));
    }

    if (missing.length || builtInUpdates.length) {
      this.invalidateCache();
    }
  }

  async findAll(): Promise<PlaybookPromptTemplateListResponse> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookPromptService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }

    const docs = await this.promptModel.find({}).sort({ category: 1, title: 1 }).exec();
    const items = docs.map((doc) => this.toResponse(doc));
    this.cachedItems = items;
    this.cachedAt = now;
    return { items };
  }

  async findByKey(key: string): Promise<PlaybookPromptTemplateResponse | null> {
    await this.seedDefaultsIfNeeded();
    const doc = await this.promptModel.findOne({ key }).exec();
    return doc ? this.toResponse(doc) : null;
  }

  async upsert(
    key: string,
    dto: UpsertPlaybookPromptTemplateRequest,
    userId: string,
  ): Promise<PlaybookPromptTemplateResponse> {
    await this.seedDefaultsIfNeeded();
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      throw new Error('Prompt key is required');
    }

    const existing = await this.promptModel.findOne({ key: normalizedKey }).exec();
    const nextVersion = (existing?.version || 0) + 1;
    const payload = {
      key: normalizedKey,
      title: dto.title.trim(),
      category: dto.category.trim(),
      description: dto.description?.trim() || '',
      systemTemplate: dto.systemTemplate ?? existing?.systemTemplate ?? '',
      userTemplate: dto.userTemplate ?? existing?.userTemplate ?? '',
      enabled: dto.enabled ?? existing?.enabled ?? true,
      version: nextVersion,
      isBuiltIn: existing?.isBuiltIn ?? false,
      updatedBy: new Types.ObjectId(userId),
      createdBy: existing?.createdBy ?? new Types.ObjectId(userId),
    };

    const updated = await this.promptModel.findOneAndUpdate(
      { key: normalizedKey },
      { $set: payload },
      { new: true, upsert: true },
    ).exec();

    this.invalidateCache();
    return this.toResponse(updated);
  }

  async getPromptOverridesPayload(): Promise<Record<string, string>> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedPayload && now - this.cachedAt < PlaybookPromptService.CACHE_TTL_MS) {
      return this.cachedPayload;
    }

    const docs = await this.promptModel.find({ enabled: true }).exec();
    const payload = docs.reduce<Record<string, string>>((acc, doc) => {
      acc[doc.key] = JSON.stringify(this.toResponse(doc));
      return acc;
    }, {});
    this.cachedPayload = payload;
    this.cachedAt = now;
    return payload;
  }

  async resetCache(): Promise<void> {
    this.invalidateCache();
  }

  getDefaultPromptKeys(): string[] {
    return DEFAULT_PROMPTS.map((item) => item.key);
  }
}
