import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useModuleTranslation } from '@/modules/localization';
import type { ConnectorOption } from '../api';
import type { AgentConnectorActionSelection, ConnectorActionOption } from '../types';

interface AgentConnectorFieldsProps {
  availableConnectors: ConnectorOption[];
  connectors: string[];
  connectorActionSelections: AgentConnectorActionSelection[];
  onConnectorsChange: (connectorIds: string[]) => void;
  onConnectorActionSelectionsChange: (selections: AgentConnectorActionSelection[]) => void;
  labels?: {
    title: string;
    description: string;
    placeholder: string;
    searchPlaceholder: string;
    emptyText: string;
    toolAccessDescription: string;
    allTools: string;
    selectedTools: string;
    noToolsAvailable: string;
  };
}

function getEnabledActionKeys(connector: ConnectorOption): string[] {
  return (connector.actions || [])
    .filter((action: ConnectorActionOption) => action.isEnabled !== false)
    .map((action: ConnectorActionOption) => action.key);
}

export function AgentConnectorFields({
  availableConnectors,
  connectors,
  connectorActionSelections,
  onConnectorsChange,
  onConnectorActionSelectionsChange,
  labels,
}: AgentConnectorFieldsProps) {
  const { t } = useModuleTranslation('agent');
  const copy = labels ?? {
    title: t('createEdit.fields.connectors'),
    description: t('createEdit.fields.connectorsDescription'),
    placeholder: t('createEdit.fields.selectConnectors'),
    searchPlaceholder: t('createEdit.fields.searchConnectors'),
    emptyText: t('createEdit.fields.noConnectorsFound'),
    toolAccessDescription: t('createEdit.fields.connectorToolAccessDescription'),
    allTools: t('createEdit.fields.connectorToolsAll'),
    selectedTools: t('createEdit.fields.connectorToolsSelected'),
    noToolsAvailable: t('createEdit.fields.connectorNoToolsAvailable'),
  };
  const selectedConnectors = availableConnectors.filter((connector) => connectors.includes(connector.id));

  const updateSelection = (connectorId: string, actionKeys: string[] | null) => {
    const nextSelections = connectorActionSelections.filter((selection) => selection.connectorId !== connectorId);
    if (actionKeys && actionKeys.length > 0) {
      nextSelections.push({ connectorId, actionKeys });
    }
    onConnectorActionSelectionsChange(nextSelections);
  };

  return (
    <div className="grid gap-4">
      <div className="space-y-2">
        <Label>{copy.title}</Label>
        <p className="text-xs text-muted-foreground">
          {copy.description}
        </p>
        <MultiSelect
          options={availableConnectors.map((connector) => ({
            value: connector.id,
            label: connector.name,
            description: connector.description,
          }))}
          value={connectors}
          onValueChange={onConnectorsChange}
          placeholder={copy.placeholder}
          searchPlaceholder={copy.searchPlaceholder}
          emptyText={copy.emptyText}
        />
      </div>

      {selectedConnectors.map((connector) => {
        const enabledActions = (connector.actions || []).filter(
          (action: ConnectorActionOption) => action.isEnabled !== false,
        );
        const selection = connectorActionSelections.find((item) => item.connectorId === connector.id);
        const mode = selection ? 'selected' : 'all';

        return (
          <div key={connector.id} className="rounded-md border p-4 space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">{connector.name}</div>
              <div className="text-xs text-muted-foreground">
                {copy.toolAccessDescription}
              </div>
            </div>

            <RadioGroup
              value={mode}
              onValueChange={(value) => {
                if (value === 'all') {
                  updateSelection(connector.id, null);
                  return;
                }
                updateSelection(connector.id, getEnabledActionKeys(connector));
              }}
              className="gap-3"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="all" />
                <span>{copy.allTools}</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="selected" />
                <span>{copy.selectedTools}</span>
              </label>
            </RadioGroup>

            {mode === 'selected' ? (
              enabledActions.length > 0 ? (
                <div className="space-y-2">
                  {enabledActions.map((action) => {
                    const checked = selection?.actionKeys.includes(action.key) ?? false;
                    return (
                      <label key={action.key} className="flex items-start gap-3 rounded-sm border p-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(isChecked) => {
                            const nextKeys = new Set(selection?.actionKeys || []);
                            if (isChecked) {
                              nextKeys.add(action.key);
                            } else {
                              nextKeys.delete(action.key);
                              if (nextKeys.size === 0) {
                                return;
                              }
                            }
                            updateSelection(connector.id, [...nextKeys]);
                          }}
                        />
                        <span className="space-y-1">
                          <span className="block font-medium">{action.label || action.key}</span>
                          <span className="block text-xs text-muted-foreground">
                            {action.description || action.key}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {copy.noToolsAvailable}
                </div>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
