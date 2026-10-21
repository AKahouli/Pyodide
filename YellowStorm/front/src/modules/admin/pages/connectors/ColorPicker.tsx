/**
 * ColorPicker - Color picker with hex input + native color preview, synced.
 */

import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { ConnectorControlHelp } from './ConnectorWorkerSettings';

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function ColorPicker({ value, onChange, placeholder = '#000000', className = '' }: Readonly<ColorPickerProps>) {
  const { t } = useModuleTranslation('admin');
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let hex = e.target.value;
    if (!hex.startsWith('#')) {
      hex = `#${hex}`;
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <ConnectorControlHelp description={t('connectors.help.color')}><Input
        aria-label={t('connectors.form.fields.color.label')}
        type='color'
        value={value || '#000000'}
        onChange={handleColorChange}
        className='w-12 h-10 shrink-0 p-0.5 border-0 cursor-pointer'
        style={{ padding: 0 }}
      /></ConnectorControlHelp>
      <ConnectorControlHelp description={t('connectors.help.color')}><Input
        aria-label={t('connectors.help.color')}
        type='text'
        value={value}
        onChange={handleHexChange}
        placeholder={placeholder}
        className='min-w-0 flex-1 uppercase font-mono'
        maxLength={7}
      /></ConnectorControlHelp>
    </div>
  );
}
