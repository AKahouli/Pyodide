import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useModuleTranslation } from "@/modules/localization";
import { useSemanticModelEditorStore } from "../../store";
import type { SemanticRecord } from "../../types";

interface Props {
  canEdit: boolean;
  planNodeTypeIds?: Set<string>;
}

function EnrichInput({
  initialValue,
  placeholder,
  onSave,
}: {
  initialValue: string;
  placeholder?: string;
  onSave: (val: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Input
      className="h-8 text-sm"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== initialValue) onSave(trimmed);
      }}
    />
  );
}

export function SemanticModelEnrichmentPanel({ canEdit, planNodeTypeIds }: Props) {
  const { t } = useModuleTranslation("semantic-model");
  const graph = useSemanticModelEditorStore((s) => s.graph);
  const commit = useSemanticModelEditorStore((s) => s.commit);

  if (!graph) return null;

  const nodeTypeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const relevantRecords = planNodeTypeIds
    ? graph.records.filter((r) => planNodeTypeIds.has(r.nodeTypeId))
    : graph.records;

  const groups: Array<{ nodeTypeId: string; label: string; records: SemanticRecord[] }> = [];
  const byType = new Map<string, SemanticRecord[]>();
  for (const record of relevantRecords) {
    const list = byType.get(record.nodeTypeId) ?? [];
    list.push(record);
    byType.set(record.nodeTypeId, list);
  }
  for (const [nodeTypeId, records] of byType) {
    const nodeType = nodeTypeMap.get(nodeTypeId);
    if (!nodeType) continue;
    const incomplete = records.filter((record) =>
      nodeType.attributes.some(
        (attr) => record.values[attr.key] === undefined || record.values[attr.key] === null || record.values[attr.key] === "",
      ),
    );
    if (incomplete.length) {
      groups.push({ nodeTypeId, label: nodeType.label, records: incomplete });
    }
  }

  if (!groups.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("enrichment.allComplete")}
        </p>
      </div>
    );
  }

  const updateValue = (record: SemanticRecord, key: string, value: string) => {
    const newValues = { ...record.values, [key]: value };
    commit(
      { type: "record.update", id: record.id, changes: { values: newValues } },
      (current) => ({
        ...current,
        records: current.records.map((r) =>
          r.id === record.id ? { ...r, values: newValues } : r,
        ),
      }),
    );
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
      <p className="text-xs text-muted-foreground">{t("enrichment.description")}</p>
      {groups.map(({ nodeTypeId, label, records }) => {
        const nodeType = nodeTypeMap.get(nodeTypeId)!;
        return (
          <section key={nodeTypeId}>
            <h3 className="mb-2 text-sm font-semibold">
              {label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({records.length})
              </span>
            </h3>
            <div className="space-y-3">
              {records.map((record) => {
                const filledAttributes = nodeType.attributes.filter(
                  (attr) => record.values[attr.key] !== undefined && record.values[attr.key] !== null && record.values[attr.key] !== "",
                );
                const missingAttributes = nodeType.attributes.filter(
                  (attr) => record.values[attr.key] === undefined || record.values[attr.key] === null || record.values[attr.key] === "",
                );
                return (
                  <article key={record.id} className="rounded-xl border bg-background p-4 shadow-sm">
                    <p className="mb-3 text-sm font-medium">{record.label}</p>
                    <dl className="space-y-2 text-sm">
                      {filledAttributes.map((attr) => (
                        <div key={attr.key} className="flex items-start justify-between gap-4 rounded-md bg-muted px-3 py-2">
                          <dt className="text-muted-foreground">{attr.label || attr.key}</dt>
                          <dd className="text-right font-medium">{String(record.values[attr.key])}</dd>
                        </div>
                      ))}
                      {missingAttributes.map((attr) => (
                        <div key={attr.key} className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2">
                          <p className="mb-1.5 text-xs text-amber-600 dark:text-amber-500">
                            {attr.label || attr.key}
                            {attr.required && <span className="ml-1 text-destructive">*</span>}
                          </p>
                          {canEdit ? (
                            <EnrichInput
                              key={`${record.id}-${attr.key}`}
                              initialValue={String(record.values[attr.key] ?? "")}
                              placeholder={attr.description || t("enrichment.fillValue")}
                              onSave={(val) => updateValue(record, attr.key, val)}
                            />
                          ) : (
                            <p className="text-xs italic text-muted-foreground">{t("enrichment.missingValue")}</p>
                          )}
                        </div>
                      ))}
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
